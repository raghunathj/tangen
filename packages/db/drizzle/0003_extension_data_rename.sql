ALTER TABLE "app_data" RENAME TO "extension_data";--> statement-breakpoint
ALTER TABLE "extension_data" RENAME COLUMN "app_id" TO "extension_id";--> statement-breakpoint
ALTER INDEX IF EXISTS "app_data_app_object_unique" RENAME TO "extension_data_ext_object_unique";
