ALTER TABLE "dcr_calls" ADD COLUMN "joint_work_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "dcrs" ADD COLUMN "territory_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "dcrs" ADD COLUMN "tour_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "dcrs" ADD CONSTRAINT "dcrs_tour_plan_id_tour_plans_id_fk" FOREIGN KEY ("tour_plan_id") REFERENCES "public"."tour_plans"("id") ON DELETE no action ON UPDATE no action;