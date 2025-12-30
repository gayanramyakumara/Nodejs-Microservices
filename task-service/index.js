require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');
const { StatusCodes } = require('http-status-codes');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/tasks')
  .then(() => console.log('Task Service: Connected to MongoDB'))
  .catch(err => console.error('Task Service: MongoDB connection error:', err));

// Task Schema
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  userId: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'archived'],
    default: 'pending'
  },
  dueDate: Date,
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Task = mongoose.model('Task', taskSchema);

// RabbitMQ connection
let channel, connection;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://rabbitmq';
const TASK_CREATED_QUEUE = 'task_created';
const TASK_UPDATED_QUEUE = 'task_updated';

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ 
      message: 'No token provided' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(StatusCodes.FORBIDDEN).json({ 
        message: 'Invalid or expired token' 
      });
    }
    req.user = user;
    next();
  });
};

// Connect to RabbitMQ with retry
async function connectRabbitMQWithRetry(retries = 5, delay = 3000) {
  while (retries) {
    try {
      connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();
      
      // Assert queues
      await channel.assertQueue(TASK_CREATED_QUEUE, { durable: true });
      await channel.assertQueue(TASK_UPDATED_QUEUE, { durable: true });
      
      console.log('Task Service: Connected to RabbitMQ');
      return;
    } catch (error) {
      console.error('RabbitMQ connection failed, retrying...', error.message);
      retries -= 1;
      
      if (retries === 0) {
        console.error('Max retries reached. Could not connect to RabbitMQ.');
        process.exit(1);
      }
      await new Promise(res => setTimeout(res, delay));
    }
  }


}

app.get('/tasks', async (req, res) => {
  try {
    const tasks = await Task.find();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/tasks', async (req, res) => {

  const { title, description, userId } = req.body;

  try {
    const task = new Task({ title, description, userId });

    const message = {
      taskId: task._id,
      title: task.title,
      description: task.description,
      userId: task.userId,
      createdAt: task.createdAt
    }

    if (!channel) {
      throw new Error('RabbitMQ channel is not established');
    }

    channel.sendToQueue('task_created', Buffer.from(JSON.stringify(message)));

    await task.save();
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }


});

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Task service app listening on port ${port}`)
  connectRabbitMQWithRetry();
})