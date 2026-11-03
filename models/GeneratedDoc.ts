import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { PIPELINE_VERSION } from '../lib/pipelineVersion';

export type GeneratedDocStatus = 'ready' | 'generating';

export interface IGeneratedDoc extends Document {
  repoUrl: string;
  repoName: string;
  repoOwner: string;
  repoId: number;
  repoKey: string;
  defaultBranch: string;
  slug: string;
  cloudinaryUrl: string;
  commitSha: string;
  etag?: string;
  lastKnownHeadSha?: string;
  commitsBehind?: number;
  lastCheckedAt?: Date;
  version: number;
  pipelineVersion: number;
  status: GeneratedDocStatus;
  lockedAt?: Date;
  lockedBy?: Types.ObjectId;
  currentPublicId: string;
  previousPublicIds: string[];
  lastRegeneratedAt?: Date;
  lastRegenAttemptAt?: Date;
  failureCount: number;
  lastError?: string;
  createdBy: Types.ObjectId;
  viewCount: number;
  createdAt: Date;
}

const GeneratedDocSchema = new Schema<IGeneratedDoc>(
  {
    repoUrl: { type: String, required: true, index: true },
    repoName: { type: String, required: true },
    repoOwner: { type: String, required: true },
    repoId: { type: Number, required: true },
    repoKey: { type: String, required: true, index: true },
    defaultBranch: { type: String, required: true, default: 'main' },
    slug: { type: String, required: true, unique: true, index: true },
    cloudinaryUrl: { type: String, required: true },
    commitSha: { type: String, required: true },
    etag: { type: String },
    lastKnownHeadSha: { type: String },
    commitsBehind: { type: Number },
    lastCheckedAt: { type: Date },
    version: { type: Number, required: true, default: 1 },
    pipelineVersion: { type: Number, required: true, default: PIPELINE_VERSION },
    status: {
      type: String,
      enum: ['ready', 'generating'],
      required: true,
      default: 'ready',
    },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    currentPublicId: { type: String, default: '' },
    previousPublicIds: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 1,
        message: 'previousPublicIds keeps at most 1 entry',
      },
    },
    lastRegeneratedAt: { type: Date },
    lastRegenAttemptAt: { type: Date },
    failureCount: { type: Number, default: 0 },
    lastError: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    viewCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

// repoId is the durable identity (survives rename/transfer). Partial index so
// legacy docs that predate the freshness migration (repoId absent) can coexist.
GeneratedDocSchema.index(
  { repoId: 1 },
  { unique: true, partialFilterExpression: { repoId: { $exists: true } } }
);

const GeneratedDocModel: Model<IGeneratedDoc> =
  mongoose.models.GeneratedDoc ??
  mongoose.model<IGeneratedDoc>('GeneratedDoc', GeneratedDocSchema);

export default GeneratedDocModel;
