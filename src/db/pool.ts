import { Pool } from "pg";

export const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "9513571949",
  max: 10,
  database:"superjoin"
});

pool.query("SELECT NOW()")
  .then((result) => {
    console.log("PostgreSQL connected:", result.rows[0]);
  })
  .catch((err) => {
    console.error("PostgreSQL connection failed:", err);
  });

pool.on("error", (err: any) => {
  console.error("Unexpected error on idle Postgres client", err);
});