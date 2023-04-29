const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
    {
        message: {
            type: String
        },
        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'account'
        },
        receiverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'account'
        },
        fileName: {
            type: String
        }
    },
    { timestamps: true }
);

const Message = mongoose.model('message', messageSchema);

module.exports = Message;
