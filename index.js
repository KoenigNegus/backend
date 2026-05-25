// ─────────────────────────────────────────────────────────────────────────────
// SmartLift REST API
//
// The React Native app cannot connect to PostgreSQL directly (no TCP sockets,
// and DB credentials must never ship inside a mobile app). This Express server
// is the bridge: the app talks HTTP to this server, this server talks to Aiven.
//
// Everything lives in one file on purpose — it is meant to be readable top to
// bottom for a school project.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[server] JWT_SECRET is not set. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(cors());                          // open CORS — needed for the Expo web build
app.use(express.json({ limit: '10mb' })); // meal image URIs can be long

// ── Helpers ──────────────────────────────────────────────────────────────────

// Wraps an async route handler so thrown errors become a clean 500 response.
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[server]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Server error' });
  });

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

// Auth middleware: requires a valid "Authorization: Bearer <token>" header.
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Row → API mappers (snake_case DB columns → camelCase the app expects) ─────

const mapUser = (r) => ({ id: r.id, email: r.email, name: r.name });

const mapProfile = (r) => ({
  userId: r.user_id,
  activities: r.activities,
  healthConditions: r.health_conditions,
  fitnessLevel: r.fitness_level,
  daysPerWeek: r.days_per_week,
  customGoals: r.custom_goals,
  calorieGoal: r.calorie_goal,
  proteinGoal: r.protein_goal,
  carbsGoal: r.carbs_goal,
  fatGoal: r.fat_goal,
  age: r.age == null ? undefined : r.age,
  height: r.height == null ? undefined : r.height,
  weight: r.weight == null ? undefined : r.weight,
});

const mapWorkout = (r) => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  description: r.description,
  date: r.created_at.toISOString(),
  durationMinutes: r.duration_minutes,
  caloriesBurned: r.calories_burned == null ? undefined : r.calories_burned,
  exercises: r.exercises,
});

const mapLog = (r) => ({
  id: r.id,
  userId: r.user_id,
  templateId: r.template_id == null ? undefined : r.template_id,
  title: r.title,
  date: r.performed_at.toISOString(),
  durationMinutes: r.duration_minutes,
  exercises: r.exercises,
});

const mapMeal = (r) => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  date: r.logged_at.toISOString(),
  calories: r.calories,
  protein_g: r.protein_g,
  carbs_g: r.carbs_g,
  fat_g: r.fat_g,
  portion: r.portion,
  imageUri: r.image_uri == null ? undefined : r.image_uri,
});

const mapChat = (r) => ({
  id: r.id,
  userId: r.user_id,
  role: r.role,
  content: r.content,
  timestamp: r.sent_at.toISOString(),
});

// ── Health check (no auth) ───────────────────────────────────────────────────

app.get('/api/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, db: 'connected' });
}));

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = await db.query(
    'INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING *',
    [email, name, hash]
  );
  const user = mapUser(result.rows[0]);
  await db.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
  res.json({ token: signToken(user), user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const row = result.rows[0];
  if (!row || !bcrypt.compareSync(password, row.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const user = mapUser(row);
  res.json({ token: signToken(user), user });
}));

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: mapUser(result.rows[0]) });
}));

// ── Profile ──────────────────────────────────────────────────────────────────

// Makes sure a profile row exists for the current user, then returns it.
async function ensureProfile(userId) {
  await db.query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  const result = await db.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
  return result.rows[0];
}

app.get('/api/profile', auth, wrap(async (req, res) => {
  res.json(mapProfile(await ensureProfile(req.user.userId)));
}));

app.put('/api/profile', auth, wrap(async (req, res) => {
  await ensureProfile(req.user.userId);
  const body = req.body || {};

  // Only the fields that are actually present in the request get updated.
  const columns = {
    activities: 'activities',
    healthConditions: 'health_conditions',
    fitnessLevel: 'fitness_level',
    daysPerWeek: 'days_per_week',
    customGoals: 'custom_goals',
    calorieGoal: 'calorie_goal',
    proteinGoal: 'protein_goal',
    carbsGoal: 'carbs_goal',
    fatGoal: 'fat_goal',
    age: 'age',
    height: 'height',
    weight: 'weight',
  };
  const jsonFields = ['activities', 'healthConditions'];

  const setClauses = [];
  const values = [req.user.userId];
  for (const [key, column] of Object.entries(columns)) {
    if (body[key] === undefined) continue;
    const isJson = jsonFields.includes(key);
    values.push(isJson ? JSON.stringify(body[key]) : body[key]);
    setClauses.push(`${column} = $${values.length}${isJson ? '::jsonb' : ''}`);
  }

  if (setClauses.length > 0) {
    setClauses.push('updated_at = now()');
    await db.query(
      `UPDATE user_profiles SET ${setClauses.join(', ')} WHERE user_id = $1`,
      values
    );
  }
  res.json(mapProfile(await ensureProfile(req.user.userId)));
}));

// ── Workout templates ────────────────────────────────────────────────────────

app.get('/api/workouts', auth, wrap(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM workouts WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.userId]
  );
  res.json(result.rows.map(mapWorkout));
}));

app.post('/api/workouts', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const result = await db.query(
    `INSERT INTO workouts (user_id, title, description, duration_minutes, calories_burned, exercises)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
    [
      req.user.userId,
      b.title || 'Untitled',
      b.description || '',
      b.durationMinutes || 60,
      b.caloriesBurned == null ? null : b.caloriesBurned,
      JSON.stringify(b.exercises || []),
    ]
  );
  res.json(mapWorkout(result.rows[0]));
}));

app.put('/api/workouts/:id', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const result = await db.query(
    `UPDATE workouts
     SET title = $3, description = $4, duration_minutes = $5, exercises = $6::jsonb
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [
      req.params.id,
      req.user.userId,
      b.title || 'Untitled',
      b.description || '',
      b.durationMinutes || 60,
      JSON.stringify(b.exercises || []),
    ]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Workout not found' });
  res.json(mapWorkout(result.rows[0]));
}));

app.delete('/api/workouts/:id', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM workouts WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.userId,
  ]);
  res.json({ ok: true });
}));

// Used by the AI "modify_workout_template" tool: update one exercise's sets/reps.
app.patch('/api/workouts/:id/exercise', auth, wrap(async (req, res) => {
  const { exerciseName, newSets, newReps } = req.body || {};
  const result = await db.query('SELECT * FROM workouts WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.userId,
  ]);
  const workout = result.rows[0];
  if (!workout) return res.status(404).json({ error: 'Template not found or access denied' });

  const exercises = (workout.exercises || []).map((ex) =>
    ex.name === exerciseName
      ? { ...ex, sets: newSets != null ? newSets : ex.sets, reps: newReps != null ? newReps : ex.reps }
      : ex
  );
  const updated = await db.query(
    'UPDATE workouts SET exercises = $3::jsonb WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.userId, JSON.stringify(exercises)]
  );
  res.json(mapWorkout(updated.rows[0]));
}));

// ── Exercises ────────────────────────────────────────────────────────────────

app.get('/api/exercises', auth, wrap(async (req, res) => {
  const result = await db.query('SELECT id, name, muscle_group FROM exercises ORDER BY name ASC');
  res.json(result.rows);
}));

// ── New Template Routines (Normalized) ───────────────────────────────────────

const mapTemplate = (r, exercises = []) => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  exercises: exercises.map(ex => ({
    id: ex.id,
    templateId: ex.template_id,
    exerciseId: ex.exercise_id,
    exerciseName: ex.exercise_name,
    muscleGroup: ex.muscle_group,
    sets: ex.sets,
    reps: ex.reps,
    orderIndex: ex.order_index
  }))
});

app.get('/api/templates', auth, wrap(async (req, res) => {
  const templatesRes = await db.query(
    'SELECT * FROM templates WHERE user_id = $1 ORDER BY created_at DESC',
    [req.user.userId]
  );
  
  if (templatesRes.rows.length === 0) return res.json([]);

  const templateIds = templatesRes.rows.map(t => t.id);
  const exercisesRes = await db.query(
    `SELECT te.*, e.name as exercise_name, e.muscle_group 
     FROM template_exercises te
     JOIN exercises e ON te.exercise_id = e.id
     WHERE te.template_id = ANY($1)
     ORDER BY te.order_index ASC`,
    [templateIds]
  );

  const templates = templatesRes.rows.map(t => {
    const exList = exercisesRes.rows.filter(ex => ex.template_id === t.id);
    return mapTemplate(t, exList);
  });

  res.json(templates);
}));

app.post('/api/templates', auth, wrap(async (req, res) => {
  const { name, exercises } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });

  await db.query('BEGIN');
  try {
    const tRes = await db.query(
      'INSERT INTO templates (user_id, name) VALUES ($1, $2) RETURNING *',
      [req.user.userId, name]
    );
    const template = tRes.rows[0];

    let exList = [];
    if (Array.isArray(exercises) && exercises.length > 0) {
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        const teRes = await db.query(
          `INSERT INTO template_exercises (template_id, exercise_id, sets, reps, order_index)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [template.id, ex.exerciseId, ex.sets || 3, ex.reps || 10, i]
        );
        
        // Fetch exercise name
        const eRes = await db.query('SELECT name, muscle_group FROM exercises WHERE id = $1', [ex.exerciseId]);
        exList.push({
          ...teRes.rows[0],
          exercise_name: eRes.rows[0].name,
          muscle_group: eRes.rows[0].muscle_group
        });
      }
    }
    
    await db.query('COMMIT');
    res.json(mapTemplate(template, exList));
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}));

app.put('/api/templates/:id', auth, wrap(async (req, res) => {
  const { name, exercises } = req.body || {};
  const tId = req.params.id;

  // Ensure template exists and belongs to user
  const check = await db.query('SELECT id FROM templates WHERE id = $1 AND user_id = $2', [tId, req.user.userId]);
  if (!check.rows[0]) return res.status(404).json({ error: 'Template not found' });

  await db.query('BEGIN');
  try {
    const tRes = await db.query(
      'UPDATE templates SET name = $1 WHERE id = $2 RETURNING *',
      [name || 'Untitled', tId]
    );

    await db.query('DELETE FROM template_exercises WHERE template_id = $1', [tId]);

    let exList = [];
    if (Array.isArray(exercises)) {
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        const teRes = await db.query(
          `INSERT INTO template_exercises (template_id, exercise_id, sets, reps, order_index)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [tId, ex.exerciseId, ex.sets || 3, ex.reps || 10, i]
        );
        const eRes = await db.query('SELECT name, muscle_group FROM exercises WHERE id = $1', [ex.exerciseId]);
        exList.push({
          ...teRes.rows[0],
          exercise_name: eRes.rows[0].name,
          muscle_group: eRes.rows[0].muscle_group
        });
      }
    }

    await db.query('COMMIT');
    res.json(mapTemplate(tRes.rows[0], exList));
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}));

app.delete('/api/templates/:id', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM templates WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
  res.json({ ok: true });
}));

// ── Workout logs (completed sessions) ────────────────────────────────────────

app.get('/api/logs', auth, wrap(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM workout_logs WHERE user_id = $1 ORDER BY performed_at DESC',
    [req.user.userId]
  );
  res.json(result.rows.map(mapLog));
}));

app.post('/api/logs', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const result = await db.query(
    `INSERT INTO workout_logs (user_id, template_id, title, performed_at, duration_minutes, exercises)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
    [
      req.user.userId,
      b.templateId || null,
      b.title || 'Workout',
      b.date || new Date().toISOString(),
      b.durationMinutes || 0,
      JSON.stringify(b.exercises || []),
    ]
  );
  res.json(mapLog(result.rows[0]));
}));

app.delete('/api/logs/:id', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM workout_logs WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.userId,
  ]);
  res.json({ ok: true });
}));

// ── Meals ────────────────────────────────────────────────────────────────────

app.get('/api/meals', auth, wrap(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM meals WHERE user_id = $1 ORDER BY logged_at DESC',
    [req.user.userId]
  );
  res.json(result.rows.map(mapMeal));
}));

app.post('/api/meals', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const result = await db.query(
    `INSERT INTO meals (user_id, name, logged_at, calories, protein_g, carbs_g, fat_g, portion, image_uri)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      req.user.userId,
      b.name || 'Meal',
      b.date || new Date().toISOString(),
      b.calories || 0,
      b.protein_g || 0,
      b.carbs_g || 0,
      b.fat_g || 0,
      b.portion || '',
      b.imageUri || null,
    ]
  );
  res.json(mapMeal(result.rows[0]));
}));

app.delete('/api/meals/:id', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM meals WHERE id = $1 AND user_id = $2', [
    req.params.id,
    req.user.userId,
  ]);
  res.json({ ok: true });
}));

// ── Chat history ─────────────────────────────────────────────────────────────

app.get('/api/chat', auth, wrap(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM chat_messages WHERE user_id = $1 ORDER BY sent_at ASC',
    [req.user.userId]
  );
  res.json(result.rows.map(mapChat));
}));

app.post('/api/chat', auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.role !== 'user' && b.role !== 'assistant') {
    return res.status(400).json({ error: 'role must be "user" or "assistant"' });
  }
  const result = await db.query(
    `INSERT INTO chat_messages (user_id, role, content, sent_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.user.userId, b.role, b.content || '', b.timestamp || new Date().toISOString()]
  );
  res.json(mapChat(result.rows[0]));
}));

app.delete('/api/chat', auth, wrap(async (req, res) => {
  await db.query('DELETE FROM chat_messages WHERE user_id = $1', [req.user.userId]);
  res.json({ ok: true });
}));

// ── Analytics ────────────────────────────────────────────────────────────────

// Estimated 1-Rep-Max per exercise (Epley formula: weight * (1 + reps / 30)).
app.get('/api/analytics/1rm', auth, wrap(async (req, res) => {
  const result = await db.query(
    `SELECT exercise_name, MAX(weight * (1.0 + reps / 30.0)) AS est_1rm
     FROM (
       SELECT ex->>'name'             AS exercise_name,
              (s->>'reps')::numeric   AS reps,
              (s->>'weight')::numeric AS weight
       FROM workout_logs wl,
            jsonb_array_elements(wl.exercises)        AS ex,
            jsonb_array_elements(ex->'completedSets') AS s
       WHERE wl.user_id = $1
     ) t
     GROUP BY exercise_name
     ORDER BY est_1rm DESC`,
    [req.user.userId]
  );
  res.json(result.rows.map((r) => ({ exercise_name: r.exercise_name, est_1rm: Number(r.est_1rm) })));
}));

// Aggregated metrics for the last 7 days — feeds the AI context engine.
app.get('/api/analytics/weekly', auth, wrap(async (req, res) => {
  const userId = req.user.userId;

  const volume = await db.query(
    `SELECT COALESCE(SUM(weight * reps), 0) AS total_volume,
            COUNT(DISTINCT log_id)          AS workout_count
     FROM (
       SELECT wl.id                    AS log_id,
              (s->>'reps')::numeric    AS reps,
              (s->>'weight')::numeric  AS weight
       FROM workout_logs wl,
            jsonb_array_elements(wl.exercises)        AS ex,
            jsonb_array_elements(ex->'completedSets') AS s
       WHERE wl.user_id = $1 AND wl.performed_at >= now() - interval '7 days'
     ) t`,
    [userId]
  );

  const meals = await db.query(
    `SELECT to_char(date_trunc('day', logged_at), 'YYYY-MM-DD') AS log_day,
            SUM(calories)  AS calories,
            SUM(protein_g) AS protein_g
     FROM meals
     WHERE user_id = $1 AND logged_at >= now() - interval '7 days'
     GROUP BY 1`,
    [userId]
  );

  const profile = await db.query('SELECT protein_goal FROM user_profiles WHERE user_id = $1', [userId]);
  const proteinGoal = profile.rows[0] ? profile.rows[0].protein_goal : 150;

  const daysLogged = meals.rows.length;
  let proteinDaysMet = 0;
  let totalCalories = 0;
  for (const m of meals.rows) {
    totalCalories += Number(m.calories);
    if (Number(m.protein_g) >= proteinGoal) proteinDaysMet++;
  }

  res.json({
    workout_count: Number(volume.rows[0].workout_count) || 0,
    total_volume_kg: Number(volume.rows[0].total_volume) || 0,
    avg_daily_calories: daysLogged > 0 ? Math.round(totalCalories / daysLogged) : 0,
    protein_hit_rate: daysLogged > 0 ? proteinDaysMet / daysLogged : 0,
    data_gap_days: 7 - daysLogged,
    confidence_score: Math.max(0.1, 1.0 - ((7 - daysLogged) / 7) * 0.65),
  });
}));

// ── Weekly summaries (written by the AI context compressor) ──────────────────

app.get('/api/summaries/latest', auth, wrap(async (req, res) => {
  const result = await db.query(
    'SELECT * FROM weekly_summaries WHERE user_id = $1 ORDER BY week_start DESC LIMIT 1',
    [req.user.userId]
  );
  if (!result.rows[0]) return res.json(null);
  const s = result.rows[0];
  res.json({ ai_summary: s.ai_summary, confidence_score: s.confidence_score });
}));

app.post('/api/summaries', auth, wrap(async (req, res) => {
  const b = req.body || {};
  await db.query(
    `INSERT INTO weekly_summaries
       (user_id, week_start, week_end, workout_count, total_volume_kg,
        avg_daily_calories, protein_hit_rate, ai_summary, confidence_score, data_gap_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, week_start) DO UPDATE SET
       week_end           = EXCLUDED.week_end,
       workout_count      = EXCLUDED.workout_count,
       total_volume_kg    = EXCLUDED.total_volume_kg,
       avg_daily_calories = EXCLUDED.avg_daily_calories,
       protein_hit_rate   = EXCLUDED.protein_hit_rate,
       ai_summary         = EXCLUDED.ai_summary,
       confidence_score   = EXCLUDED.confidence_score,
       data_gap_days      = EXCLUDED.data_gap_days`,
    [
      req.user.userId,
      b.weekStart,
      b.weekEnd,
      b.workoutCount || 0,
      b.totalVolumeKg || 0,
      b.avgDailyCalories || 0,
      b.proteinHitRate || 0,
      b.aiSummary || null,
      b.confidenceScore == null ? 1.0 : b.confidenceScore,
      b.dataGapDays || 0,
    ]
  );
  res.json({ ok: true });
}));

// ── Fallback ─────────────────────────────────────────────────────────────────

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

// ── Startup: create tables, then listen ──────────────────────────────────────

async function start() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('[server] Database schema is ready.');
  } catch (err) {
    console.error('[server] Failed to initialise the database:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`[server] SmartLift API listening on http://localhost:${PORT}`);
    console.log(`[server] Health check: http://localhost:${PORT}/api/health`);
  });
}

start();
