import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { connectDB } from '../lib/db';
import GeneratedDocModel from '../models/GeneratedDoc';
import UserModel from '../models/User';
import mongoose from 'mongoose';

async function cleanup() {
  await connectDB();
  const res1 = await GeneratedDocModel.deleteMany({});
  const res2 = await UserModel.updateMany({}, { $set: { freeDocsUsed: 0 } });
  console.log(`Cleared ${res1.deletedCount} docs. Reset ${res2.modifiedCount} users.`);
  await mongoose.disconnect();
}
cleanup().catch(console.error);
