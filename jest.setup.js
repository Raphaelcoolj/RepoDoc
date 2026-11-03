process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/repodoc-tests';
