const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let emailsCollection = null;

async function connectMongoDB() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing');
    }

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    const db = client.db('atlas');
    emailsCollection = db.collection('early_access');

    await emailsCollection.createIndex({ email: 1 }, { unique: true });

    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    throw error;
  }
}

let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/early-access', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    if (!emailsCollection) {
      await connectMongoDB();
    }

    const emailObj = {
      email,
      createdAt: new Date(),
      source: 'website'
    };

    try {
      await emailsCollection.insertOne(emailObj);
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered'
        });
      }
      throw error;
    }

    if (transporter) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: '🌍 Welcome to Atlas Early Access!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">Welcome to Atlas! 🌍</h2>
              <p>Thank you for joining our early access list!</p>
              <p>You're now in line to be among the first to experience <strong>Atlas</strong>.</p>
              <p><strong>Launch Date: May 7, 2027</strong></p>
            </div>
          `
        });
      } catch (error) {
        console.log('Email sending failed, but signup was recorded');
      }
    }

    res.json({
      success: true,
      message: 'Successfully joined early access!',
      email
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.get('/api/admin/signups', async (req, res) => {
  try {
    const adminKey = req.query.key;

    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    if (!emailsCollection) {
      await connectMongoDB();
    }

    const signups = await emailsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: signups.length,
      signups
    });

  } catch (error) {
    console.error('Admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date()
  });
});

module.exports = app;