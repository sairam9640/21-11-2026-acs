import mongoose from 'mongoose';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_isp_os_test_db', {
        serverSelectionTimeoutMS: 800,
      });
    } catch {
      // Local MongoDB not available in unit test environment
    }
  }
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      try {
        await collections[key].deleteMany({});
      } catch {
        // ignore
      }
    }
  }
});
