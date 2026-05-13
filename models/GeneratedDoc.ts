import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IGeneratedDoc extends Document {
  repoUrl: string;
  repoName: string;
  repoOwner: string;
  slug: string;
  cloudinaryUrl: string;
  createdBy: Types.ObjectId;
  viewCount: number;
  createdAt: Date;
}

const GeneratedDocSchema = new Schema<IGeneratedDoc>(
  {
    repoUrl: { type: String, required: true, unique: true, index: true },
    repoName: { type: String, required: true },
    repoOwner: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    cloudinaryUrl: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    viewCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

const GeneratedDocModel: Model<IGeneratedDoc> =
  mongoose.models.GeneratedDoc ??
  mongoose.model<IGeneratedDoc>('GeneratedDoc', GeneratedDocSchema);

export default GeneratedDocModel;
