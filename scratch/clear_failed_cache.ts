import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { connectDB } from '../lib/db';
import GeneratedDocModel from '../models/GeneratedDoc';
import mongoose from 'mongoose';

async function clearCache(repoUrl: string) {
  await connectDB();
  const result = await GeneratedDocModel.deleteOne({ repoUrl });
  console.log(`Deleted ${result.deletedCount} records for: ${repoUrl}`);
  await mongoose.disconnect();
}

const targetUrl = 'https://github.com/Raphaelcoolj/investment-site.git';
clearCache(targetUrl).catch(console.error);
