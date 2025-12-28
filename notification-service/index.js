const amqp = require('amqplib')


async function start() {
    try { 
      connection = await amqp.connect('amqp://rabbitmq_node');
      channel = await connection.createChannel();
      await channel.assertQueue('task_created');
      console.log('Notification Service listening to task_created queue');
     
      channel.consume('task_created', msg => {
        const task = JSON.parse(msg.content.toString());
        console.log(`Received task created event for task: ${task.title}`);
        // Here you would typically send an email or push notification
        channel.ack(msg);
      });
      

    } catch (error) {
      console.error('RabbitMQ connection failed, retrying...', error.message);
    }
  
}


start();