// auth-service/index.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { StatusCodes } = require('http-status-codes');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(bodyParser.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/auth')
  .then(() => console.log('Auth Service: Connected to MongoDB'))
  .catch(err => console.error('Auth Service: MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  username: { 
    type: String, 
    required: true, 
    unique: true,
    minlength: 3,
    maxlength: 30
  },
  password: { 
    type: String, 
    required: true,
    minlength: 8,
    select: false
  },
  role: { 
    type: String, 
    enum: ['user', 'admin'], 
    default: 'user' 
  }
}, { 
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.__v;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

// JWT Generation
const generateToken = (userId, role = 'user') => {
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
};

// Auth Middleware
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

// Routes
app.post('/api/auth/register', [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please include a valid email'),
  body('username').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  try {
    const { email, username, password, name } = req.body;

    // Check if user exists
    let user = await User.findOne({ $or: [{ email }, { username }] });
    if (user) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: 'User already exists with this email or username'
      });
    }

    // Create user in auth service
    user = await User.create({
      email,
      username,
      password,
      role: (await User.countDocuments({})) === 0 ? 'admin' : 'user'
    });

    // Generate JWT
    const token = generateToken(user._id, user.role);

    // Create user profile in user service
    try {
      await axios.post(
        `${process.env.USER_SERVICE_URL}/api/users`, 
        { userId: user._id, name, email },
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
    } catch (error) {
      // If profile creation fails, delete the auth user to maintain consistency
      await User.findByIdAndDelete(user._id);
      throw error;
    }

    const userResponse = user.toJSON();
    res.status(StatusCodes.CREATED).json({
      user: userResponse,
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    const status = error.response?.status || StatusCodes.INTERNAL_SERVER_ERROR;
    const message = error.response?.data?.message || 'Error during registration';
    res.status(status).json({ message });
  }
});

// Login endpoint
app.post('/api/auth/login', [
  body('username').notEmpty().withMessage('Username or email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(StatusCodes.BAD_REQUEST).json({ errors: errors.array() });
  }

  try {
    const { username, password } = req.body;
    
    // Find user by email or username
    const user = await User.findOne({
      $or: [
        { email: username },
        { username: username }
      ]
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ 
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT
    const token = generateToken(user._id, user.role);

    // Get user profile from user service
    let profile = {};
    try {
      const profileResponse = await axios.get(
        `${process.env.USER_SERVICE_URL}/api/users/me`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      profile = profileResponse.data;
    } catch (error) {
      console.error('Error fetching user profile:', error.message);
    }

    res.json({
      user: {
        ...user.toJSON(),
        ...profile
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error during login' 
    });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(StatusCodes.NOT_FOUND).json({ 
        message: 'User not found' 
      });
    }

    // Get user profile from user service
    let profile = {};
    try {
      const profileResponse = await axios.get(
        `${process.env.USER_SERVICE_URL}/api/users/me`,
        { headers: { 'Authorization': req.headers['authorization'] } }
      );
      profile = profileResponse.data;
    } catch (error) {
      console.error('Error fetching user profile:', error.message);
    }

    res.json({
      ...user.toJSON(),
      ...profile
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      message: 'Error fetching user data' 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Auth Service running on port ${PORT}`);
});

module.exports = {
  authenticateToken
};