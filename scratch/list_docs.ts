import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { connectDB } from '../lib/db';
import GeneratedDocModel from '../models/GeneratedDoc';
import mongoose from 'mongoose';

async function listDocs() {
  await connectDB();
  const docs = await GeneratedDocModel.find({}, 'repoUrl slug').lean();
  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
}
listDocs().catch(console.error);
