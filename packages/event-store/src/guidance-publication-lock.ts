import type { Sql } from "postgres";

// Serialize both publishers before they read the active publication, including
// the first release where there is no pointer row to lock yet.
export const lockGuidancePublication = async (sql: Sql): Promise<void> => {
  await sql`select pg_advisory_xact_lock(hashtext('ah.guidance-publication:SK:injured'))`;
};
