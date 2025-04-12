import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

// Initialize Express and HTTP server
const app = express();
const httpServer = createServer(app);

// Configure Socket.io with environment-aware CORS
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Type definitions
interface UserData {
  username: string;
  language: string;
}

interface RoomData {
  [key: string]: {
    users: Map<string, UserData>;
    peers: Map<string, string>;
  };
}

// Store rooms and users
const rooms: RoomData = {};

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('Socket.io server operational');
});

// WebSocket connection handler
io.on('connection', (socket: Socket) => {
  console.log(`Client connected: ${socket.id}`);

  // WebRTC signaling handlers
  socket.on('offer', (data: { target: string; sdp: RTCSessionDescriptionInit }) => {
    socket.to(data.target).emit('offer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('answer', (data: { target: string; sdp: RTCSessionDescriptionInit }) => {
    socket.to(data.target).emit('answer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data: { target: string; candidate: RTCIceCandidateInit }) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Room management
  socket.on('join_room', (data: { 
    room: string; 
    username: string; 
    language: string; 
    peerId: string 
  }) => {
    const { room, username, language, peerId } = data;

    if (!rooms[room]) {
      rooms[room] = {
        users: new Map(),
        peers: new Map()
      };
    }

    const currentRoom = rooms[room];
    currentRoom.users.set(socket.id, { username, language });
    currentRoom.peers.set(socket.id, peerId);
    socket.join(room);

    // Notify room members
    socket.to(room).emit('user_joined', {
      userId: socket.id,
      username,
      language,
      peerId
    });

    // Send updated user list
    io.to(room).emit('users_list', 
      Array.from(currentRoom.users.entries()).map(([id, user]) => ({
        id,
        username: user.username,
        language: user.language,
        peerId: currentRoom.peers.get(id)
      }))
    );
  });

  // Stream management
  socket.on('start_stream', (roomName: string) => {
    socket.to(roomName).emit('user_started_stream', socket.id);
  });

  socket.on('stop_stream', (roomName: string) => {
    socket.to(roomName).emit('user_stopped_stream', socket.id);
  });

  // Messaging system
  socket.on('message', (data: { 
    room: string; 
    text: string; 
    sender: string 
  }) => {
    if (rooms[data.room]) {
      io.to(data.room).emit('message', {
        ...data,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    Object.entries(rooms).forEach(([roomName, room]) => {
      if (room.users.has(socket.id)) {
        room.users.delete(socket.id);
        room.peers.delete(socket.id);

        if (room.users.size === 0) {
          delete rooms[roomName];
        } else {
          io.to(roomName).emit('user_left', socket.id);
          io.to(roomName).emit('users_list', 
            Array.from(room.users.entries()).map(([id, user]) => ({
              id,
              username: user.username,
              language: user.language,
              peerId: room.peers.get(id)
            }))
          );
        }
      }
    });
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Server configuration
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server operational on port ${PORT}`);
});
