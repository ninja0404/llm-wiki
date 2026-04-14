CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"team_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"content_hash" text,
	"embedding" vector(1536),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"entity_name" text NOT NULL,
	"slug" text NOT NULL,
	"entity_type" text NOT NULL,
	"description" text NOT NULL,
	"source_chunk_ids" text[] NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"batch_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"raw_content" text,
	"url" text,
	"file_key" text,
	"content_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ingest_state" jsonb,
	"trace_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_page_id" uuid NOT NULL,
	"target_page_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_page_id" uuid NOT NULL,
	"source_chunk_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_page_id" uuid NOT NULL,
	"content_snapshot" text NOT NULL,
	"change_type" text NOT NULL,
	"changed_by" text,
	"source_id" uuid,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"page_type" text DEFAULT 'entity' NOT NULL,
	"tags" text[] DEFAULT '{}',
	"status" text DEFAULT 'draft' NOT NULL,
	"confidence" text,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"last_lint_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"details" jsonb,
	"trace_id" uuid,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"step" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" text,
	"duration_ms" integer,
	"source_id" uuid,
	"batch_index" integer,
	"prompt_version" text,
	"trace_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period" text NOT NULL,
	"tokens_used" bigint DEFAULT 0 NOT NULL,
	"tokens_budget" bigint DEFAULT 2000000 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_extractions" ADD CONSTRAINT "source_extractions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_source_page_id_wiki_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_links" ADD CONSTRAINT "wiki_links_target_page_id_wiki_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_chunks" ADD CONSTRAINT "wiki_page_chunks_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_chunks" ADD CONSTRAINT "wiki_page_chunks_source_chunk_id_source_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."source_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_versions" ADD CONSTRAINT "wiki_page_versions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_invocations" ADD CONSTRAINT "llm_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_usage" ADD CONSTRAINT "workspace_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "chunk_source_idx" ON "source_chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "chunk_hash_idx" ON "source_chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "extraction_source_idx" ON "source_extractions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "extraction_slug_idx" ON "source_extractions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "source_workspace_idx" ON "sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "source_hash_idx" ON "sources" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "link_unique_idx" ON "wiki_links" USING btree ("source_page_id","target_page_id");--> statement-breakpoint
CREATE INDEX "link_source_idx" ON "wiki_links" USING btree ("source_page_id");--> statement-breakpoint
CREATE INDEX "link_target_idx" ON "wiki_links" USING btree ("target_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_chunk_unique_idx" ON "wiki_page_chunks" USING btree ("wiki_page_id","source_chunk_id");--> statement-breakpoint
CREATE INDEX "page_chunk_wiki_idx" ON "wiki_page_chunks" USING btree ("wiki_page_id");--> statement-breakpoint
CREATE INDEX "page_chunk_source_idx" ON "wiki_page_chunks" USING btree ("source_chunk_id");--> statement-breakpoint
CREATE INDEX "version_page_idx" ON "wiki_page_versions" USING btree ("wiki_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_workspace_slug_idx" ON "wiki_pages" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "wiki_workspace_idx" ON "wiki_pages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "wiki_status_idx" ON "wiki_pages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conv_workspace_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conv_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "msg_conv_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "activity_workspace_idx" ON "activity_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "activity_trace_idx" ON "activity_logs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_workspace_idx" ON "llm_invocations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "llm_trace_idx" ON "llm_invocations" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "llm_created_idx" ON "llm_invocations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_idempotent_idx" ON "llm_invocations" USING btree ("source_id","batch_index","step");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_workspace_period_idx" ON "workspace_usage" USING btree ("workspace_id","period");