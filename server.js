const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Initialize Express and HTTP server
const app = express();
const httpServer = http.createServer(app);

// Configure Socket.io with CORS
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Store room and user information
const rooms = new Map();

class Room {
  constructor(name) {
    this.name = name;
    this.users = new Map();
    this.peers = new Map(); // Store peer connections
  }

  addUser(userId, userData) {
    this.users.set(userId, userData);
  }

  removeUser(userId) {
    this.users.delete(userId);
    this.peers.delete(userId);
  }

  addPeer(userId, peerId) {
    this.peers.set(userId, peerId);
  }

  getUserLanguages() {
    return Array.from(this.users.values()).map((user) => user.language);
  }

  isEmpty() {
    return this.users.size === 0;
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('Socket.io server operational');
});

// WebSocket connection handler
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      sdp: data.sdp,
      sender: socket.id,
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      sdp: data.sdp,
      sender: socket.id,
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id,
    });
  });

  // Room management
  socket.on('join_room', (data) => {
    const { room, username, language, peerId } = data;

    // Create room if it doesn't exist
    if (!rooms.has(room)) {
      rooms.set(room, new Room(room));
    }

    const currentRoom = rooms.get(room);

    // Add user to room
    socket.join(room);
    currentRoom.addUser(socket.id, { username, language });
    currentRoom.addPeer(socket.id, peerId);

    // Notify existing users to create peer connections with new user
    socket.to(room).emit('user_joined', {
      userId: socket.id,
      username,
      language,
      peerId,
    });

    // Send current users list with peer IDs
    const roomUsers = Array.from(currentRoom.users.entries()).map(([id, user]) => ({
      id,
      username: user.username,
      language: user.language,
      peerId: currentRoom.peers.get(id),
    }));
    io.to(room).emit('users_list', roomUsers);
  });

  // Stream management
  socket.on('start_stream', (roomName) => {
    socket.to(roomName).emit('user_started_stream', socket.id);
  });

  socket.on('stop_stream', (roomName) => {
    socket.to(roomName).emit('user_stopped_stream', socket.id);
  });

  // Messaging system
  socket.on('message', async (data) => {
    const room = rooms.get(data.room);
    if (room) {
      io.to(data.room).emit('message', {
        ...data,
        timestamp: new Date().toLocaleTimeString(),
      });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    for (const [roomName, room] of rooms.entries()) {
      if (room.users.has(socket.id)) {
        room.removeUser(socket.id);

        // Remove room if empty
        if (room.isEmpty()) {
          rooms.delete(roomName);
        } else {
          // Notify others about user leaving
          io.to(roomName).emit('user_left', socket.id);

          // Update users list
          const roomUsers = Array.from(room.users.entries()).map(([id, user]) => ({
            id,
            username: user.username,
            language: user.language,
            peerId: room.peers.get(id),
          }));
          io.to(roomName).emit('users_list', roomUsers);
        }

        break;
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

// Server configuration
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
