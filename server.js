const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: process.env.CLIENT_URL || '*',
        methods: ['GET', 'POST'],
        credentials: true,
    }
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
        return Array.from(this.users.values()).map(user => user.language);
    }

    isEmpty() {
        return this.users.size === 0;
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle WebRTC signaling
    socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', {
            sdp: data.sdp,
            sender: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', {
            sdp: data.sdp,
            sender: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    socket.on('join_room', (data) => {
        const { room, username, language, peerId } = data;
        
        // Create room if it doesn't exist
        if (!rooms.has(room)) {
            rooms.set(room, new Room(room));
        }

        const currentRoom = rooms.get(room);
        io.emit('user_joined', {
            userId: socket.id,
            username: data.username,
            language: data.language,
            room: data.room
        });

        // Add user to room
        socket.join(room);
        currentRoom.addUser(socket.id, { username, language });
        currentRoom.addPeer(socket.id, peerId);

        // Notify existing users to create peer connections with new user
        socket.to(room).emit('user_joined', {
            userId: socket.id,
            username,
            language,
            peerId
        });

        // Send current users list with peer IDs
        const roomUsers = Array.from(currentRoom.users.entries()).map(([id, user]) => ({
            id,
            username: user.username,
            language: user.language,
            peerId: currentRoom.peers.get(id)
        }));
        io.to(room).emit('users_list', roomUsers);
    });

    socket.on('admin_request_data', () => {
        console.log('Admin requesting data...');
        
        // Prepare users data
        const usersData = [];
        rooms.forEach((room, roomName) => {
            room.users.forEach((userData, userId) => {
                usersData.push({
                    id: userId,
                    username: userData.username,
                    language: userData.language,
                    room: roomName,
                    status: 'Active'
                });
            });
        });

        console.log('Sending users data:', usersData);
        socket.emit('users_list', usersData);
        
        // Prepare rooms data
        const roomsData = {};
        rooms.forEach((room, roomName) => {
            roomsData[roomName] = {
                users: Array.from(room.users.entries()).map(([id, user]) => ({
                    id,
                    username: user.username,
                    language: user.language
                }))
            };
        });
        
        console.log('Sending rooms data:', roomsData);
        socket.emit('admin_data', roomsData);
    });

    socket.on('start_stream', (roomName) => {
        socket.to(roomName).emit('user_started_stream', socket.id);
    });

    socket.on('stop_stream', (roomName) => {
        socket.to(roomName).emit('user_stopped_stream', socket.id);
    });

    socket.on('message', async (data) => {
        const room = rooms.get(data.room);
        if (room) {
            io.to(data.room).emit('message', {
                ...data,
                timestamp: new Date().toLocaleTimeString()
            });
        }
    });

    socket.on('disconnect', () => {
        // Remove user from their room
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
                        peerId: room.peers.get(id)
                    }));
                    io.to(roomName).emit('users_list', roomUsers);
                }
                break;
            }
            io.emit('user_left', socket.id);
        }
        console.log('User disconnected:', socket.id);
    });
    socket.on('admin_create_room', (roomName) => {
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Room(roomName));
            io.emit('room_created', roomName);
        }
    });

    socket.on('admin_delete_room', (roomName) => {
        if (rooms.has(roomName)) {
            const room = rooms.get(roomName);
            // Disconnect all users in the room
            room.users.forEach((userData, userId) => {
                io.to(userId).emit('room_deleted');
            });
            rooms.delete(roomName);
            io.emit('room_deleted', roomName);
        }
    });

    socket.on('admin_kick_user', (userId) => {
        const socketToKick = io.sockets.sockets.get(userId);
        if (socketToKick) {
            socketToKick.disconnect();
        }
    });
    
    socket.on('admin_ban_user', (userId) => {
        // Implement your ban logic here
        // You might want to maintain a list of banned users
        const socketToBan = io.sockets.sockets.get(userId);
        if (socketToBan) {
            // Add to banned list
            bannedUsers.add(userId);
            socketToBan.disconnect();
        }
    });
});

const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
