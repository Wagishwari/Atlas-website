const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---- Local JSON fallback storage ----
const DATA_FILE = path.join(__dirname, 'signups.json');

function readLocalSignups() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]');
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read local signups file:', error);
    return [];
  }
}

function writeLocalSignups(signups) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(signups, null, 2));
}

// ---- MongoDB (stubbed) ----
// Returns null so the app always falls back to local JSON storage.
// To re-enable MongoDB later, restore the real connection logic here
// and make sure MONGODB_URI is set in your environment variables.
let emailsCollection = null;

async function connectMongoDB() {
  console.log('MongoDB is disabled, using local JSON file storage');
  return null;
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

    // Always attempt Mongo first (currently stubbed to return null)
    if (!emailsCollection) {
      await connectMongoDB();
    }

    const emailObj = {
      email,
      createdAt: new Date(),
      source: 'website'
    };

    if (emailsCollection) {
      // MongoDB path (only runs if you re-enable Mongo later)
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
    } else {
      // Local JSON fallback path
      const signups = readLocalSignups();
      const alreadyExists = signups.some(s => s.email.toLowerCase() === email.toLowerCase());

      if (alreadyExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered'
        });
      }

      signups.push(emailObj);
      writeLocalSignups(signups);
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

    let signups;

    if (emailsCollection) {
      signups = await emailsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
    } else {
      signups = readLocalSignups().sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
    }

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

if (require.main === module) {
  const PORT = process.env.PORT || 3000;

  app.listen(PORT, async () => {
    console.log(`Atlas server running on http://localhost:${PORT}`);
    await connectMongoDB();
  });
}

module.exports = app;