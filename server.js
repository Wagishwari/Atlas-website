const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- MongoDB (used only if MONGODB_URI is set) ----------

let cachedClient = null;
let cachedCollection = null;

async function getEmailsCollection() {
  if (cachedCollection) {
    return cachedCollection;
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
    console.log('Connected to MongoDB');
  }

  const db = cachedClient.db('atlas');
  cachedCollection = db.collection('early_access');
  await cachedCollection.createIndex({ email: 1 }, { unique: true });

  return cachedCollection;
}

// ---------- Local JSON fallback (used if MONGODB_URI is NOT set) ----------
// NOTE: On Vercel, only /tmp is writable, and it can be wiped between
// invocations/deployments. This fallback is fine for quick testing,
// but for real production signups you'll want a database again.

const isVercel = !!process.env.VERCEL;
const DATA_FILE = isVercel
  ? path.join(os.tmpdir(), 'atlas-emails.json')
  : path.join(__dirname, 'data', 'emails.json');

function readLocalEmails() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Error reading local email store:', err);
    return [];
  }
}

function writeLocalEmails(emails) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(emails, null, 2));
}

// ---------- Unified storage functions used by the routes ----------

async function saveEmail(emailObj) {
  if (process.env.MONGODB_URI) {
    const collection = await getEmailsCollection();
    await collection.insertOne(emailObj);
    return emailObj;
  }

  const emails = readLocalEmails();
  if (emails.some(e => e.email === emailObj.email)) {
    const err = new Error('Duplicate email');
    err.code = 11000;
    throw err;
  }
  emails.push(emailObj);
  writeLocalEmails(emails);
  return emailObj;
}

async function getAllEmails() {
  if (process.env.MONGODB_URI) {
    const collection = await getEmailsCollection();
    return collection.find({}).sort({ createdAt: -1 }).toArray();
  }

  const emails = readLocalEmails();
  return emails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---------- Email transporter ----------

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

// ---------- Routes ----------

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

    const emailObj = {
      email,
      createdAt: new Date(),
      source: 'website'
    };

    try {
      await saveEmail(emailObj);
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

    const signups = await getAllEmails();

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

  app.listen(PORT, () => {
    console.log(`Atlas server running on http://localhost:${PORT}`);
  });
}

module.exports = app;