import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IApiKeyEntry {
  name: string; // "openai" | "anthropic" | "grok" | "gemini" | "deepseek"
  key: string;  // AES-256-CBC encrypted
}

export interface ILinkedAccount {
  provider: string;           // "github" | "google"
  providerAccountId: string;
}

export interface IUser extends Document {
  name: string;
  email: string;
  image: string;
  accounts: ILinkedAccount[];
  apiKeys: {
    provider1?: IApiKeyEntry;
    provider2?: IApiKeyEntry;
  };
  freeDocsUsed: number;
  freeDocsResetAt: Date;
  onboardingComplete: boolean;
  createdAt: Date;
}

const LinkedAccountSchema = new Schema<ILinkedAccount>(
  {
    provider: { type: String, required: true },
    providerAccountId: { type: String, required: true },
  },
  { _id: false }
);

const ApiKeyEntrySchema = new Schema<IApiKeyEntry>(
  {
    name: { type: String, required: true },
    key: { type: String, required: true },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    image: { type: String, default: '' },
    accounts: { type: [LinkedAccountSchema], default: [] },
    apiKeys: {
      provider1: { type: ApiKeyEntrySchema },
      provider2: { type: ApiKeyEntrySchema },
    },
    freeDocsUsed: { type: Number, default: 0 },
    freeDocsResetAt: { type: Date, default: () => new Date() },
    onboardingComplete: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false }
);

const UserModel: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>('User', UserSchema);

export default UserModel;
