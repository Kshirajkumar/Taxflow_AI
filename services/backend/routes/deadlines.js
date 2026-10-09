/**
 * TaxFlow.AI — Compliance Tasks & Tax Deadlines Routes
 * Supabase: Stores all compliance tasks, deadlines, filing status, and progress
 */

const express = require('express');
const router = express.Router();
const { supabase, isConnected } = require('../db/supabase');

// --- In-Memory Fallback ---
let fallbackTasks = [
  {
    id: 'task-001', client_id: '11111111-1111-1111-1111-111111111111',
    client_name: 'Reliable Motors Pvt Ltd', form_type: 'GSTR-3B',
    due_date: '2026-10-20', status: 'Pending', progress: 75,
    assigned_to: 'CA Rajesh Kumar', notes: 'Missing 2 purchase invoices'
  },
  {
    id: 'task-002', client_id: '22222222-2222-2222-2222-222222222222',
    client_name: 'Dr. Ananya Roy', form_type: 'ITR-3',
    due_date: '2026-10-31', status: 'Docs Received', progress: 90,
    assigned_to: 'CA Priya Sharma', notes: 'Form 16 verified, bank stmt pending'
  },
  {
    id: 'task-003', client_id: '33333333-3333-3333-3333-333333333333',
    client_name: 'Apex Logistics LLP', form_type: 'GSTR-1',
    due_date: '2026-10-11', status: 'Filed', progress: 100,
    assigned_to: 'CA Rajesh Kumar', notes: 'Filed on time'
  },
  {
    id: 'task-004', client_id: '11111111-1111-1111-1111-111111111111',
    client_name: 'Reliable Motors Pvt Ltd', form_type: 'GSTR-1',
    due_date: '2026-10-11', status: 'Filed', progress: 100,
    assigned_to: 'CA Rajesh Kumar', notes: 'Filed on time'
  },
  {
    id: 'task-005', client_id: '33333333-3333-3333-3333-333333333333',
    client_name: 'Apex Logistics LLP', form_type: 'TDS-26Q',
    due_date: '2026-10-31', status: 'In Progress', progress: 60,
    assigned_to: 'CA Rajesh Kumar', notes: 'Q2 TDS return preparation in progress'
  }
];

// GET /api/v1/deadlines — Get all compliance tasks (optional filters)
router.get('/', async (req, res) => {
  try {
    if (isConnected) {
      let query = supabase.from('compliance_tasks').select('*').order('due_date', { ascending: true });
      if (req.query.clientId) query = query.eq('client_id', req.query.clientId);
      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.assignedTo) query = query.eq('assigned_to', req.query.assignedTo);
      const { data, error } = await query;
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    let tasks = fallbackTasks;
    if (req.query.clientId) tasks = tasks.filter(t => t.client_id === req.query.clientId);
    if (req.query.status) tasks = tasks.filter(t => t.status === req.query.status);
    res.json({ success: true, count: tasks.length, source: 'demo', data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/deadlines/upcoming — Tasks due in next N days
router.get('/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 15;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() + days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    if (isConnected) {
      const { data, error } = await supabase
        .from('compliance_tasks')
        .select('*')
        .lte('due_date', cutoffStr)
        .neq('status', 'Filed')
        .order('due_date', { ascending: true });
      if (error) throw error;
      return res.json({ success: true, count: data.length, source: 'supabase', data });
    }
    const upcoming = fallbackTasks.filter(t => t.status !== 'Filed' && t.due_date <= cutoffStr);
    res.json({ success: true, count: upcoming.length, source: 'demo', data: upcoming });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/deadlines — Create a new compliance task
router.post('/', async (req, res) => {
  try {
    const { client_id, client_name, form_type, due_date, assigned_to, notes } = req.body;
    if (!client_id || !form_type || !due_date) {
      return res.status(400).json({ success: false, message: 'client_id, form_type, and due_date are required' });
    }

    if (isConnected) {
      const { data, error } = await supabase
        .from('compliance_tasks')
        .insert([{ client_id, client_name, form_type, due_date, assigned_to, notes, status: 'Pending', progress: 0 }])
        .select().single();
      if (error) throw error;
      return res.status(201).json({ success: true, source: 'supabase', data });
    }

    const newTask = {
      id: `task_${Date.now()}`, client_id, client_name, form_type, due_date,
      assigned_to, notes, status: 'Pending', progress: 0, created_at: new Date().toISOString()
    };
    fallbackTasks.push(newTask);
    res.status(201).json({ success: true, source: 'demo', data: newTask });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/v1/deadlines/:id — Update progress/status of a task
router.patch('/:id', async (req, res) => {
  try {
    if (isConnected) {
      const { data, error } = await supabase
        .from('compliance_tasks').update(req.body).eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ success: true, source: 'supabase', data });
    }
    const idx = fallbackTasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Task not found' });
    fallbackTasks[idx] = { ...fallbackTasks[idx], ...req.body };
    res.json({ success: true, source: 'demo', data: fallbackTasks[idx] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/deadlines/summary — Dashboard summary counts
router.get('/summary', async (req, res) => {
  try {
    const getCount = (arr, status) => arr.filter(t => t.status === status).length;

    if (isConnected) {
      const { data, error } = await supabase.from('compliance_tasks').select('status');
      if (error) throw error;
      return res.json({
        success: true, source: 'supabase',
        data: {
          total: data.length,
          pending: data.filter(t => t.status === 'Pending').length,
          inProgress: data.filter(t => t.status === 'In Progress').length,
          docsReceived: data.filter(t => t.status === 'Docs Received').length,
          filed: data.filter(t => t.status === 'Filed').length
        }
      });
    }

    res.json({
      success: true, source: 'demo',
      data: {
        total: fallbackTasks.length,
        pending: getCount(fallbackTasks, 'Pending'),
        inProgress: getCount(fallbackTasks, 'In Progress'),
        docsReceived: getCount(fallbackTasks, 'Docs Received'),
        filed: getCount(fallbackTasks, 'Filed')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
