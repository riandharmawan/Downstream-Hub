/**
 * Express app (no listen). Used by server.js and by tests.
 */
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const applicationsRoutes = require('./routes/applications');
const allowedDomainsRoutes = require('./routes/allowedDomains');
const businessUnitsRoutes = require('./routes/businessUnits');
const usersRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const ssoRoutes = require('./routes/sso');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'downstream-hub-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/allowed-domains', allowedDomainsRoutes);
app.use('/api/business-units', businessUnitsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sso', ssoRoutes);

module.exports = app;
