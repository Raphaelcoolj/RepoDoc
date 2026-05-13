import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { connectDB } from '../lib/db';
import GeneratedDocModel from '../models/GeneratedDoc';
import mongoose from 'mongoose';

async function resetEverything() {
  await connectDB();
  await GeneratedDocModel.deleteMany({});
  await UserModel.updateMany({}, { $set: { freeDocsUsed: 0 } });
  await mongoose.disconnect();
}
// Add missing UserModel import in local scope if needed or just use the existing one
import UserModel from '../models/User';

resetEverything().catch(console.error);
