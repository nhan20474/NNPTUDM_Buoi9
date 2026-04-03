var express = require('express');
var router = express.Router();
let { checkLogin } = require('../utils/authHandler');
let messageModel = require('../schemas/messages');
let userModel = require('../schemas/users');
let mongoose = require('mongoose');
let multer = require('multer');
let path = require('path');

let storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        let ext = path.extname(file.originalname);
        let name = Date.now() + '-' + Math.round(Math.random() * 2000000000) + ext;
        cb(null, name);
    }
});

let uploadMessageFile = multer({
    storage: storage,
    limits: 5 * 1024 * 1024
});

router.get('/:userID', checkLogin, async function (req, res, next) {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.userID)) {
            return res.status(404).send({ message: 'userID not found' });
        }

        let currentUserId = req.user._id;
        let otherUserId = req.params.userID;

        let otherUser = await userModel.findOne({ _id: otherUserId, isDeleted: false });
        if (!otherUser) {
            return res.status(404).send({ message: 'userID not found' });
        }

        let messages = await messageModel.find({
            $or: [
                { from: currentUserId, to: otherUserId },
                { from: otherUserId, to: currentUserId }
            ]
        })
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl')
            .sort({ createdAt: 1 });

        res.send(messages);
    } catch (error) {
        res.status(400).send({ message: error.message });
    }
});

router.post('/', checkLogin, uploadMessageFile.single('file'), async function (req, res, next) {
    try {
        let toUserId = req.body.to;
        if (!toUserId || !mongoose.Types.ObjectId.isValid(toUserId)) {
            return res.status(404).send({ message: 'userID not found' });
        }

        let toUser = await userModel.findOne({ _id: toUserId, isDeleted: false });
        if (!toUser) {
            return res.status(404).send({ message: 'userID not found' });
        }

        let messageContent = null;
        if (req.file) {
            messageContent = {
                type: 'file',
                text: req.file.path.replace(/\\/g, '/')
            };
        } else if (req.body.text) {
            messageContent = {
                type: 'text',
                text: req.body.text
            };
        } else {
            return res.status(400).send({ message: 'messageContent is required' });
        }

        let newMessage = new messageModel({
            from: req.user._id,
            to: toUserId,
            messageContent: messageContent
        });

        await newMessage.save();

        let saved = await messageModel.findById(newMessage._id)
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl');

        res.send(saved);
    } catch (error) {
        res.status(400).send({ message: error.message });
    }
});

router.get('/', checkLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;

        let messages = await messageModel.find({
            $or: [
                { from: currentUserId },
                { to: currentUserId }
            ]
        })
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl')
            .sort({ createdAt: -1 });

        let lastMessagesByUser = new Map();

        for (let message of messages) {
            let otherUser = message.from._id.toString() === currentUserId.toString()
                ? message.to
                : message.from;
            let otherUserId = otherUser._id.toString();
            if (!lastMessagesByUser.has(otherUserId)) {
                lastMessagesByUser.set(otherUserId, message);
            }
        }

        res.send(Array.from(lastMessagesByUser.values()));
    } catch (error) {
        res.status(400).send({ message: error.message });
    }
});

module.exports = router;