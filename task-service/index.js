const express = require('express')
const mongoose = require('mongoose')
const bodyParser = require('body-parser')
const amqp = require('amqplib')

const app = express()
const port = 3002

app.use(bodyParser.json())

mongoose.connect('mongodb://mongo:27017/tasks').then(() => {
  console.log('Connected to MongoDB')
}).catch(err => {
  console.error('Failed to connect to MongoDB', err)
});

const taskSchema = new mongoose.Schema({
  title: String,
  description: String,
  userId: String,
  createdAt: { type: Date, default: Date.now }
});

const Task = mongoose.model('Task', taskSchema);


let channel, connection;
// RabbitMQ connection setup would go here (omitted for brevity)

async function connectRabbitMQWithRetry(
  retries = 5,
  delay = 3000
) {
  // RabbitMQ connection logic would go here (omitted for brevity)

  while (retries) {
    try {
      // Attempt to connect to RabbitMQ
      // If successful, break the loop

      connection = await amqp.connect('amqp://rabbitmq_node');
      channel = await connection.createChannel();
      await channel.assertQueue('task_created');
      console.log('Connected to RabbitMQ');
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