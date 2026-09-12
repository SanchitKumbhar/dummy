const { Server } = require('socket.io');

let io;

module.exports = {
  // 1. Called once in your main index.js to attach Socket.io to your HTTP server
  init: (ioInstance) => {
    io = ioInstance;

    io.on('connection', (socket) => {
      console.log('New client connected via socket:', socket.id);

      // Optional: Allow clients to join specific rooms (e.g., per store or user)
      socket.on('join_sync_room', (roomId) => {
        socket.join(roomId);
        console.log(`Socket ${socket.id} joined room ${roomId}`);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
      });
    });

    return io;
  },

  // 2. Called by your controllers to send real-time data
  getIO: () => {
    if (!io) {
      console.warn('Socket.io is not initialized yet!');
      // Return a dummy object to prevent the controller from crashing
      return {
        emit: () => {},
        to: () => ({ emit: () => {} })
      };
    }
    return io;
  }
};