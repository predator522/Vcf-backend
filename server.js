const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sagevcf';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== MODELS ====================

// Session Schema
const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  organizer: { type: String, required: true },
  target: { type: Number, required: true, min: 2 },
  description: { type: String, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  createdAt: { type: Date, default: Date.now }
});

// Participant Schema
const ParticipantSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, ref: 'Session' },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  country: { type: String, default: 'Unknown' },
  joinedAt: { type: Date, default: Date.now }
});

// Compound indexes for uniqueness
ParticipantSchema.index({ sessionId: 1, phone: 1 }, { unique: true });
ParticipantSchema.index({ sessionId: 1, fullName: 1 }, { unique: true });

// Group Schema
const GroupSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, ref: 'Session' },
  name: { type: String, required: true },
  link: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Admin Schema
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', SessionSchema);
const Participant = mongoose.model('Participant', ParticipantSchema);
const Group = mongoose.model('Group', GroupSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ----- SESSIONS -----

// Get all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session by ID
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const { sessionId, name, organizer, target, description } = req.body;
    
    const session = new Session({
      sessionId,
      name,
      organizer,
      target,
      description: description || ''
    });
    
    await session.save();
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update session (close)
app.put('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { status } = req.body;
    const session = await Session.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { status },
      { new: true }
    );
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete session
app.delete('/api/sessions/:sessionId', async (req, res) => {
  try {
    await Session.findOneAndDelete({ sessionId: req.params.sessionId });
    await Participant.deleteMany({ sessionId: req.params.sessionId });
    await Group.deleteMany({ sessionId: req.params.sessionId });
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- PARTICIPANTS -----

// Get participants for a session
app.get('/api/participants/:sessionId', async (req, res) => {
  try {
    const participants = await Participant.find({ sessionId: req.params.sessionId });
    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add participant
app.post('/api/participants', async (req, res) => {
  try {
    const { sessionId, fullName, phone, country } = req.body;
    
    // Check if session exists and is open
    const session = await Session.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status === 'closed') {
      return res.status(400).json({ error: 'Session is closed' });
    }
    
    // Check participant count
    const count = await Participant.countDocuments({ sessionId });
    if (count >= session.target) {
      return res.status(400).json({ error: 'Session is full' });
    }
    
    const participant = new Participant({
      sessionId,
      fullName,
      phone,
      country: country || 'Unknown'
    });
    
    await participant.save();
    
    // Auto-close if target reached
    const newCount = await Participant.countDocuments({ sessionId });
    if (newCount >= session.target) {
      session.status = 'closed';
      await session.save();
    }
    
    res.status(201).json(participant);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Duplicate entry (phone or name already registered)' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Delete participant
app.delete('/api/participants/:sessionId/:participantId', async (req, res) => {
  try {
    const result = await Participant.findOneAndDelete({
      sessionId: req.params.sessionId,
      _id: req.params.participantId
    });
    if (!result) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    res.json({ message: 'Participant removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----- GROUPS -----

// Get group for session
app.get('/api/groups/:sessionId', async (req, res) => {
  try {
    const group = await Group.findOne({ sessionId: req.params.sessionId });
    res.json(group || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all groups
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.find();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create group
app.post('/api/groups', async (req, res) => {
  try {
    const { sessionId, name, link } = req.body;
    const group = new Group({ sessionId, name, link });
    await group.save();
    res.status(201).json(group);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ----- ADMIN -----

// Verify admin password
app.post('/api/admin/verify', async (req, res) => {
  try {
    const { password } = req.body;
    let admin = await Admin.findOne({ username: 'admin' });
    
    if (!admin) {
      // Create default admin
      admin = new Admin({
        username: 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin123'
      });
      await admin.save();
    }
    
    const isValid = admin.password === password;
    res.json({ valid: isValid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin stats
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalSessions = await Session.countDocuments();
    const totalParticipants = await Participant.countDocuments();
    const activeSessions = await Session.countDocuments({ status: 'open' });
    
    res.json({
      totalSessions,
      totalParticipants,
      activeSessions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
}); 
