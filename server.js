const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
let db = null;
let emailsCollection = null;

async function connectMongoDB() {
  try {
    if (!process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is missing');
}
    
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('atlas');
    emailsCollection = db.collection('early_access');
    
    // Create index
    await emailsCollection.createIndex({ email: 1 }, { unique: true });
    
    console.log('✓ Connected to MongoDB');
    return db;
  } catch (error) {
    console.log('⚠️  MongoDB connection failed. Using local JSON file.');
    return null;
  }
}

// Local JSON file storage (fallback)
const storageFile = path.join(__dirname, 'emails.json');

function loadEmails() {
  try {
    if (fs.existsSync(storageFile)) {
      const data = fs.readFileSync(storageFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('Using fresh storage');
  }
  return [];
}

function saveEmail(emailObj) {
  const emails = loadEmails();
  if (!emails.find(e => e.email === emailObj.email)) {
    emails.push(emailObj);
    console.log("Local JSON saving disabled on Vercel");
  }
}

// Email Service
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Early Access Signup
app.post('/api/early-access', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    const emailObj = {
      email,
      createdAt: new Date(),
      source: 'website'
    };

    // Save to MongoDB if connected, else local file
    if (emailsCollection) {
      try {
        await emailsCollection.insertOne(emailObj);
      } catch (error) {
        if (error.code === 11000) {
          return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        throw error;
      }
    } else {
  return res.status(500).json({
    success: false,
    message: "MongoDB not connected"
  });
}

    // Send confirmation email
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
              <p>You're now in line to be among the first to experience <strong>Atlas</strong> — your AI-powered travel planning companion.</p>
              
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="color: #1d4ed8;">What's Coming</h3>
                <ul>
                  <li>🤖 AI-powered personalized itineraries</li>
                  <li>✈️ One-click flight, hotel, and train bookings</li>
                  <li>🗺️ Real-time AI guide during your trip</li>
                  <li>💰 Smart budget tracking</li>
                  <li>👥 Group trip planning</li>
                </ul>
              </div>

              <p><strong>Launch Date: May 7, 2027</strong></p>
              <p>We'll send you exclusive early-bird pricing and special perks before launch!</p>

              <p style="margin-top: 30px; color: #666; font-size: 12px;">
                © 2026 Atlas Travel. All rights reserved.
              </p>
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
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all signups (admin endpoint)
app.get('/api/admin/signups', async (req, res) => {
  try {
    const adminKey = req.query.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    let signups = [];
    if (emailsCollection) {
      signups = await emailsCollection.find({}).sort({ createdAt: -1 }).toArray();
    } else {
      signups = loadEmails().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    res.json({ 
      success: true, 
      count: signups.length,
      signups 
    });

  } catch (error) {
    console.error('Admin error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete signup (admin)
app.delete('/api/admin/signups/:email', async (req, res) => {
  try {
    const adminKey = req.query.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const email = req.params.email;

    if (emailsCollection) {
      await emailsCollection.deleteOne({ email });
    } else {
      const emails = loadEmails().filter(e => e.email !== email);
      fs.writeFileSync(storageFile, JSON.stringify(emails, null, 2));
    }

    res.json({ success: true, message: 'Email deleted' });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Export signups as CSV (admin)
app.get('/api/admin/export-csv', async (req, res) => {
  try {
    const adminKey = req.query.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    let signups = [];
    if (emailsCollection) {
      signups = await emailsCollection.find({}).toArray();
    } else {
      signups = loadEmails();
    }

    // Create CSV
    let csv = 'Email,Signup Date\n';
    signups.forEach(signup => {
      const date = new Date(signup.createdAt).toLocaleString();
      csv += `${signup.email},${date}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="atlas-signups.csv"');
    res.send(csv);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Atlas Website running on http://localhost:${PORT}`);
  console.log(`📧 Email endpoint: POST /api/early-access`);
  console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`📊 Admin API: GET /api/admin/signups?key=YOUR_ADMIN_KEY\n`);
  
  // Connect to MongoDB
  await connectMongoDB();
});
