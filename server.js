const express = require("express");
const { message } = require("statuses");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

// Store room and user information
const rooms = new Map();
const messageHistory = new Map();

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

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join_room", (data) => {
        const { room, username, language, peerId } = data;

        // Create room if it doesn't exist
        if (!rooms.has(room)) {
            rooms.set(room, new Room(room));
        }

        const currentRoom = rooms.get(room);
        io.emit("user_joined", {
            userId: socket.id,
            username: data.username,
            language: data.language,
            room: data.room,
        });

        // Add user to room
        socket.join(room);
        currentRoom.addUser(socket.id, { username, language });
        currentRoom.addPeer(socket.id, peerId);

        // Notify existing users to create peer connections with new user
        socket.to(room).emit("user_joined", {
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
        io.to(room).emit("users_list", roomUsers);
    });
    socket.on("error", (error) => {
        console.error("Socket error:", error);
        socket.emit("error", "An unexpected error occurred");
    });
    socket.on("admin_request_data", () => {
        console.log("Admin requesting data...");

        // Prepare users data
        const usersData = [];
        rooms.forEach((room, roomName) => {
            room.users.forEach((userData, userId) => {
                usersData.push({
                    id: userId,
                    username: userData.username,
                    language: userData.language,
                    room: roomName,
                    status: "Active",
                });
            });
        });

        console.log("Sending users data:", usersData);
        socket.emit("users_list", usersData);

        // Prepare rooms data
        const roomsData = {};
        rooms.forEach((room, roomName) => {
            roomsData[roomName] = {
                users: Array.from(room.users.entries()).map(([id, user]) => ({
                    id,
                    username: user.username,
                    language: user.language,
                })),
            };
        });

        const messagesData = {};
        messageHistory.forEach((messages, roomName) => {
            messagesData[roomName] = messages;
        });

        socket.emit("admin_messages", messagesData);
        socket.emit("admin_data", roomsData);
    });
    socket.on("add_reaction", (data) => {
        const { message_id, emoji, username, room } = data;

        if (!messageHistory.has(room)) {
            return;
        }

        const messages = messageHistory.get(room);
        const messageIndex = messages.findIndex((msg) => msg.message_id === message_id);

        if (messageIndex !== -1) {
            const message = messages[messageIndex];

            // Initialize reactions array if it doesn't exist
            if (!message.reactions) {
                message.reactions = [];
            }

            // Find existing reaction or create new one
            const existingReaction = message.reactions.find((r) => r.emoji === emoji);
            if (existingReaction) {
                // Add user to existing reaction if not already there
                if (!existingReaction.users.includes(username)) {
                    existingReaction.users.push(username);
                }
            } else {
                // Create new reaction
                message.reactions.push({
                    emoji: emoji,
                    users: [username],
                });
            }

            // Broadcast the updated reaction to all users in the room
            io.to(room).emit("reaction_updated", {
                message_id: message_id,
                reactions: message.reactions,
            });
        }
    });

    socket.on("message", async (data) => {
        const room = rooms.get(data.room);
        if (room) {
            const messageData = {
                ...data,
                timestamp: new Date().toLocaleTimeString(),
                userId: socket.id,
                username: room.users.get(socket.id)?.username || "Unknown",
                message: data.text,
                message_id: `${socket.id}_${Date.now()}`, // Add unique message ID
                reactions: [], // Initialize empty reactions array
            };

            // Store message in history
            if (!messageHistory.has(data.room)) {
                messageHistory.set(data.room, []);
            }

            messageHistory.get(data.room).push(messageData);

            // Broadcast to room and admins
            io.to(data.room).emit("message", messageData);
            io.emit("admin_message", messageData); // New event for admins
        }
    });

    socket.on("disconnect", () => {
        // Remove user from their room
        for (const [roomName, room] of rooms.entries()) {
            if (room.users.has(socket.id)) {
                room.removeUser(socket.id);

                // Remove room if empty
                if (room.isEmpty()) {
                    rooms.delete(roomName);
                } else {
                    // Notify others about user leaving
                    io.to(roomName).emit("user_left", socket.id);

                    // Update users list
                    const roomUsers = Array.from(room.users.entries()).map(([id, user]) => ({
                        id,
                        username: user.username,
                        language: user.language,
                        peerId: room.peers.get(id),
                    }));
                    io.to(roomName).emit("users_list", roomUsers);
                }
                break;
            }
            io.emit("user_left", socket.id);
        }
        console.log("User disconnected:", socket.id);
    });
    socket.on("admin_create_room", (data) => {
        try {
            const room = data;
            // Validate room name
            if (!room || typeof room !== "string") {
                return socket.emit("error", "Invalid room name");
            }

            // Check if room already exists
            if (rooms.has(room)) {
                return socket.emit("error", "Room already exists");
            }
            // Create new room with admin settings
            rooms.set(room, new Room(room));

            // Notify all users about new room
            io.emit("room_created", {
                room,
            });

            // Log admin room creation
            console.log(`Admin created room: ${room} by admin`);
        } catch (error) {
            console.error("Error in admin room creation:", error);
            socket.emit("error", "Failed to create admin room");
        }
    });

    socket.on("user_speaking_started", (data) => {
        const { room, username } = data;
        if (!rooms.has(room)) {
            console.log(`Speaking event for invalid room: ${room}`);
            return;
        }
        console.log(`User ${username} started speaking in room ${room}`);
        socket.to(room).emit("user_speaking_started", { username });
    });
    
    socket.on("user_speaking_stopped", (data) => {
        const { room, username } = data;
        if (!rooms.has(room)) {
            console.log(`Speaking event for invalid room: ${room}`);
            return;
        }
        console.log(`User ${username} stopped speaking in room ${room}`);
        socket.to(room).emit("user_speaking_stopped", { username });
    });

    // Admin Delete Room Method
    socket.on("admin_delete_room", (data) => {
        try {
            const roomName = data;
            // Validate room existence
            if (!rooms.has(roomName)) {
                return socket.emit("error", "Room does not exist");
            }
            const room = rooms.get(roomName);
            // Notify all users in the room
            room.users.forEach((userId) => {
                io.to(userId).emit("room_deleted", {
                    roomName,
                });
            });

            // Disconnect all users from the room
            room.users.forEach((userId) => {
                const userSocket = io.sockets.sockets.get(userId);
                if (userSocket) {
                    userSocket.leave(roomName);
                }
            });

            // Delete the room
            rooms.delete(roomName);

            // Notify all users about room deletion
            io.emit("room_list_updated", Array.from(rooms.keys()));

            // Log admin room deletion
            console.log(`Admin deleted room: ${roomName} by admin ${socket.id}`);
        } catch (error) {
            console.error("Error in admin room deletion:", error);
            socket.emit("error", "Failed to delete room");
        }
    });

    socket.on("admin_kick_user", (userId) => {
        const socketToKick = io.sockets.sockets.get(userId);
        if (socketToKick) {
            socketToKick.disconnect();
        }
    });

    socket.on("admin_ban_user", (userId) => {
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
