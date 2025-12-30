# Node.js Microservices — Task App

Node.js microservices example implementing a simple Task App using MongoDB, RabbitMQ and Docker.

**Overview**

This repository contains a small set of microservices that together implement a Task management application. Each service is a focused Node.js + Express app using Mongoose for MongoDB access. Services communicate asynchronously via RabbitMQ and are containerized with Docker (or run locally).

**Tech Stack**

- **Platform:** Node.js microservices
- **Frameworks/Libraries:** Express, Mongoose
- **Database:** MongoDB
- **Broker:** RabbitMQ
- **Containers:** Docker & Docker Compose

**Features**

- Create and list tasks
- User service for authentication/user data (minimal example)
- Notification service publishes/subscribes via RabbitMQ
- Decoupled services for scalability and resilience

**Repository layout**

- `user-service/` — user API and auth
- `task-service/` — task CRUD and business logic
- `notification-service/` — notifications (RabbitMQ consumer)
- `docker-compose.yml` — orchestration for all services, MongoDB and RabbitMQ
- `readme/design.png` — architecture diagram

**Architecture**

![Architecture](readme/design.png)

**Getting started (Docker Compose)**

1. Ensure Docker and Docker Compose are installed.
2. From the repository root, bring up all services:

```bash
docker-compose up -d --build
```

3. Watch logs for a service (example):

```bash
docker-compose logs -f task-service
```

**Run locally (development)**

Each service contains its own `package.json`. To run a service locally:

```bash
cd task-service
npm install
npm start
```

Make sure a MongoDB instance and RabbitMQ are reachable (you can use the containers from `docker-compose`).

**Environment**

Each service reads configuration from environment variables (e.g., `MONGO_URI`, `RABBITMQ_URL`, `PORT`). Check the individual service `package.json` and `index.js` for exact variable names and defaults.

**Tests**

Run tests per service (if present):

```bash
cd user-service
npm test
```

**Notes & next steps**

- This is a sample implementation intended to demonstrate microservice patterns with Node.js, MongoDB and RabbitMQ.
- Extend authentication, add persistence optimizations, and improve observability for production use.

If you'd like, I can also: add explicit environment examples, add Docker healthchecks, or wire a quick Postman collection for the APIs.
