// user-service/index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { StatusCodes } = require('http-status-codes');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/users')
  .then(() => console.log('User Service: Connected to MongoDB'))
  .catch(err => console.error('User Service: MongoDB connection error:', err));

// User Profile Schema
const userProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  bio: {
    type: String,
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'light'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Add index for faster queries
userProfileSchema.index({ userId: 1 }, { unique: true });
userProfileSchema.index({ email: 1 }, { unique: true });

const UserProfile = mongoose.model('UserProfile', userProfileSchema);

// Authentication Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(StatusCodes.UNAUTHORIZED).json({ 
      message: 'No token provided' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(StatusCodes.FORBIDDEN).json({ 
        message: 'Invalid or expired token' 
      });
    }
    req.user = decoded;
    next();
  });
};

// Create user profile
app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    const { userId, name, email } = req.body;
    
    // Check if profile already exists
    const existingProfile = await UserProfile.findOne({ 
      $or: [{ userId }, { email }] 
    });
    
    if (existingProfile) {
      return res.status(StatusCodes.CONFLICT).json({
        message: 'User profile already exists'
      });
    }

    const profile = await UserProfile.create({
      userId,
      name,
      email,
      preferences: {
        theme: 'light',
        notifications: {
          email: true,
          push: true
        }
      }
    });

    res.status(StatusCodes.CREATED).json(profile);
  } catch (error) {
    console.error('Create profile error:', error);
    if (error.name === 'ValidationError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error creating user profile'
    });
  }
});

// Get current user profile
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const profile = await UserProfile.findOne({ userId: req.user.userId });
    if (!profile) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'Profile not found'
      });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching user profile'
    });
  }
});

// Update user profile
app.patch('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const updates = Object.keys(req.body);
    const allowedUpdates = ['name', 'bio', 'avatar', 'preferences'];
    const isValidOperation = updates.every(update => 
      allowedUpdates.includes(update.split('.')[0]) // Handle nested updates
    );

    if (!isValidOperation) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: 'Invalid updates!',
        allowedUpdates
      });
    }

    const profile = await UserProfile.findOne({ userId: req.user.userId });
    if (!profile) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'Profile not found'
      });
    }

    // Apply updates
    updates.forEach(update => {
      // Handle nested updates (e.g., 'preferences.theme')
      const path = update.split('.');
      if (path.length === 1) {
        profile[path[0]] = req.body[path[0]];
      } else if (path.length === 2) {
        if (!profile[path[0]]) profile[path[0]] = {};
        profile[path[0]][path[1]] = req.body[path[0]][path[1]];
      }
    });

    await profile.save();
    res.json(profile);
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.name === 'ValidationError') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error updating profile'
    });
  }
});

// Get user by ID (for internal use by other services)
app.get('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    // Only allow admins to access other users' profiles
    if (req.user.role !== 'admin' && req.user.userId !== req.params.userId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: 'Not authorized to access this resource'
      });
    }

    const profile = await UserProfile.findOne({ userId: req.params.userId });
    if (!profile) {
      return res.status(StatusCodes.NOT_FOUND).json({
        message: 'User not found'
      });
    }
    res.json(profile);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching user'
    });
  }
});

// Make sure this route is defined before any catch-all routes
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    // Only allow admins to list all users
    if (req.user.role !== 'admin') {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: 'Not authorized to access this resource'
      });
    }

    // Rest of your implementation...
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await UserProfile.find({})
      .select('-__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await UserProfile.countDocuments();

    res.json({
      data: users,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      message: 'Error fetching users'
    });
  }
});

// Make sure this is the last route (catch-all 404)
app.use((req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`User Service running on port ${PORT}`);
});

module.exports = app;