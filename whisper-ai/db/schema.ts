import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").unique(),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    theme: text("theme").default("system"),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).default(true),
    nsfwEnabled: integer("nsfw_enabled", { mode: "boolean" }).default(false),
    hfModelPreference: text("hf_model_preference"),
    hfApiKey: text("hf_api_key"),
    consentGiven: integer("consent_given", { mode: "boolean" }).default(false),
    consentGivenAt: text("consent_given_at"),
    dataCollectionConsent: integer("data_collection_consent", { mode: "boolean" }).default(false),
    termsAcceptedAt: text("terms_accepted_at"),
    subscriptionTier: text("subscription_tier").default("free"),
    tokensUsed: real("tokens_used").default(0),
    tokensLimit: real("tokens_limit").default(20),
    lastTokenRefresh: text("last_token_refresh"),
    lastActive: text("last_active"),
    isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
    banned: integer("banned", { mode: "boolean" }).default(false),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => ({
    emailIdx: index("idx_profiles_email").on(table.email),
    subscriptionTierIdx: index("idx_profiles_subscription_tier").on(table.subscriptionTier),
    lastActiveIdx: index("idx_profiles_last_active").on(table.lastActive),
  }),
);

export const chatHistory = sqliteTable(
  "chat_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    messages: text("messages").notNull(),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  },
  (table) => ({
    userIdx: index("idx_chat_history_user_id").on(table.userId),
  }),
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    razorpaySubscriptionId: text("razorpay_subscription_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    amount: integer("amount").default(0),
    status: text("status").default("active"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at"),
  },
  (table) => ({
    userIdx: index("idx_subscriptions_user_id").on(table.userId),
  }),
);

export const tokenPurchases = sqliteTable(
  "token_purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    tokensPurchased: integer("tokens_purchased").notNull(),
    amount: integer("amount").notNull(),
    razorpayPaymentId: text("razorpay_payment_id"),
    status: text("status").default("completed"),
    createdAt: text("created_at"),
  },
  (table) => ({
    userIdx: index("idx_token_purchases_user_id").on(table.userId),
  }),
);

export const tokenUsage = sqliteTable(
  "token_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    tokensUsed: real("tokens_used").notNull(),
    isLocal: integer("is_local", { mode: "boolean" }).default(false),
    createdAt: text("created_at"),
  },
  (table) => ({
    userIdx: index("idx_token_usage_user_id").on(table.userId),
  }),
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => profiles.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    prompt: text("prompt").notNull(),
    response: text("response"),
    modelUsed: text("model_used"),
    backend: text("backend"),
    createdAt: text("created_at"),
  },
  (table) => ({
    userIdx: index("idx_chats_user_id").on(table.userId),
  }),
);

export const generatedImages = sqliteTable(
  "generated_images",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => profiles.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    prompt: text("prompt").notNull(),
    modelId: text("model_id"),
    imageUrl: text("image_url"),
    isLocal: integer("is_local", { mode: "boolean" }).default(false),
    createdAt: text("created_at"),
  },
  (table) => ({
    userIdx: index("idx_generated_images_user_id").on(table.userId),
  }),
);

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  createdAt: text("created_at"),
});
