import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import express from 'express';

// Types
interface UserData {
    username: string;
    language: string;
}

interface RoomUser extends UserData {
    id: string;
    peerId: string;
}

interface SignalingData {
    target: string;
    sdp: any;
    sender: string;
}

interface IceData {
    target: string;
    candidate: any;
    sender: string;
}

interface JoinRoomData {
    room: string;
    username: string;
    language: string;
    peerId: string;
}

interface MessageData {
    room: string;
    sender: string;
    content: string;
    timestamp?: string;
}

// Room Class
class Room {
    private name: string;
    private users: Map<string, UserData>;
    private peers: Map<string, string>;

    constructor(name: string) {
        this.name = name;
        this.users = new Map();
        this.peers = new Map();
    }

    addUser(userId: string, userData: UserData): void {
        this.users.set(userId, userData);
    }

    removeUser(userId: string): void {
        this.users.delete(userId);
        this.peers.delete(userId);
    }

    addPeer(userId: string, peerId: string): void {
        this.peers.set(userId, peerId);
    }

    getUserLanguages(): string[] {
        return Array.from(this.users.values()).map(user => user.language);
    }

    isEmpty(): boolean {
        return this.users.size === 0;
    }

    getUsers(): Map<string, UserData> {
        return this.users;
    }

    getPeers(): Map<string, string> {
        return this.peers;
    }

    hasUser(userId: string): boolean {
        return this.users.has(userId);
    }
}

// Server Setup
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store room and user information
const rooms = new Map<string, Room>();

// Socket Connection Handler
io.on('connection', (socket: Socket) => {
    console.log('User connected:', socket.id);

    // Handle WebRTC signaling
    socket.on('offer', (data: SignalingData) => {
        socket.to(data.target).emit('offer', {
            sdp: data.sdp,
            sender: socket.id
        });
    });

    socket.on('answer', (data: SignalingData) => {
        socket.to(data.target).emit('answer', {
            sdp: data.sdp,
            sender: socket.id
        });
    });

    socket.on('ice-candidate', (data: IceData) => {
        socket.to(data.target).emit('ice-candidate', {
            candidate: data.candidate,
            sender: socket.id
        });
    });

    socket.on('join_room', (data: JoinRoomData) => {
        const { room, username, language, peerId } = data;
        
        // Create room if it doesn't exist
        if (!rooms.has(room)) {
            rooms.set(room, new Room(room));
        }

        const currentRoom = rooms.get(room)!;

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
        const roomUsers = Array.from(currentRoom.getUsers().entries()).map(([id, user]) => ({
            id,
            username: user.username,
            language: user.language,
            peerId: currentRoom.getPeers().get(id)
        }));
        
        io.to(room).emit('users_list', roomUsers);
    });

    socket.on('start_stream', (roomName: string) => {
        socket.to(roomName).emit('user_started_stream', socket.id);
    });

    socket.on('stop_stream', (roomName: string) => {
        socket.to(roomName).emit('user_stopped_stream', socket.id);
    });

    socket.on('message', async (data: MessageData) => {
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
            if (room.hasUser(socket.id)) {
                room.removeUser(socket.id);
                
                // Remove room if empty
                if (room.isEmpty()) {
                    rooms.delete(roomName);
                } else {
                    // Notify others about user leaving
                    io.to(roomName).emit('user_left', socket.id);
                    
                    // Update users list
                    const roomUsers = Array.from(room.getUsers().entries()).map(([id, user]) => ({
                        id,
                        username: user.username,
                        language: user.language,
                        peerId: room.getPeers().get(id)
                    }));
                    io.to(roomName).emit('users_list', roomUsers);
                }
                break;
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

// Start server
const PORT: number = parseInt(process.env.PORT || '5000', 10);
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Basic error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

export default app;
