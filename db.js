const mysql = require("mysql2/promise");
require("dotenv").config();

const config = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ai_interview_platform",
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
};

const pool = mysql.createPool(config);

async function hasTable(name) {
  const [rows] = await pool.query("SHOW TABLES LIKE ?", [name]);
  return rows.length > 0;
}
async function columns(table) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM \`${table}\``);
  return new Set(rows.map(x => x.Field));
}
async function addColumn(table, name, definition) {
  const c = await columns(table);
  if (!c.has(name)) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
}

async function ensureDatabase() {
  const server = await mysql.createConnection({host: config.host, user: config.user, password: config.password, port: config.port});
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  await server.end();

  // USERS: supports both the new schema and the older schema used by earlier project versions.
  if (!await hasTable("users")) {
    await pool.query(`CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      role ENUM('student','hr') NOT NULL DEFAULT 'student',
      phone VARCHAR(30) NULL,
      company VARCHAR(150) NULL,
      skills TEXT NULL,
      bio TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  } else {
    await addColumn("users","password_hash","VARCHAR(255) NULL AFTER email");
    await addColumn("users","role","VARCHAR(20) NOT NULL DEFAULT 'student'");
    await addColumn("users","phone","VARCHAR(30) NULL");
    await addColumn("users","company","VARCHAR(150) NULL");
    await addColumn("users","skills","TEXT NULL");
    await addColumn("users","bio","TEXT NULL");
    await addColumn("users","created_at","TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    // Old database may have password NOT NULL. Make it nullable so registration can use password_hash.
    const c = await columns("users");
    if (c.has("password")) { try { await pool.query("ALTER TABLE users MODIFY COLUMN password VARCHAR(255) NULL"); } catch {} }
    if (c.has("password_hash") && c.has("password")) await pool.query("UPDATE users SET password_hash=password WHERE (password_hash IS NULL OR password_hash='') AND password IS NOT NULL");
  }

  if (!await hasTable("interviews")) {
    await pool.query(`CREATE TABLE interviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      hr_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      interview_type VARCHAR(100) DEFAULT 'Technical',
      scheduled_at DATETIME NOT NULL,
      duration_minutes INT DEFAULT 30,
      status ENUM('scheduled','live','completed','cancelled') DEFAULT 'scheduled',
      room_id VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (hr_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  } else {
    const c=await columns("interviews");
    await addColumn("interviews","student_id","INT NULL"); await addColumn("interviews","hr_id","INT NULL");
    await addColumn("interviews","title","VARCHAR(200) NULL"); await addColumn("interviews","interview_type","VARCHAR(100) NULL DEFAULT 'Technical'");
    await addColumn("interviews","scheduled_at","DATETIME NULL"); await addColumn("interviews","duration_minutes","INT NULL DEFAULT 30");
    await addColumn("interviews","status","VARCHAR(30) NULL DEFAULT 'scheduled'"); await addColumn("interviews","room_id","VARCHAR(100) NULL");
    await addColumn("interviews","created_at","TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    const c2=await columns("interviews");
    if(c2.has("scheduled_date")) { try { await pool.query("UPDATE interviews SET scheduled_at=TIMESTAMP(scheduled_date, COALESCE(start_time,'00:00:00')) WHERE scheduled_at IS NULL"); } catch {} }
    // Older schema had extra required date/time columns. They must be nullable for the new API.
    for (const col of ["scheduled_date","start_time","end_time"]) { if (c2.has(col)) { try { await pool.query(`ALTER TABLE interviews MODIFY COLUMN ${col} ${col === "scheduled_date" ? "DATE" : "TIME"} NULL`); } catch {} } }
    await pool.query("UPDATE interviews SET status='scheduled' WHERE status IS NULL OR status=''");
    // Existing rows can remain; new rows use current columns.
  }

  if (!await hasTable("questions")) await pool.query(`CREATE TABLE questions (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,role_name VARCHAR(150) DEFAULT 'General',difficulty VARCHAR(50) DEFAULT 'Medium',question_text TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB`);
  else { await addColumn("questions","user_id","INT NULL"); await addColumn("questions","role_name","VARCHAR(150) DEFAULT 'General'"); await addColumn("questions","difficulty","VARCHAR(50) DEFAULT 'Medium'"); await addColumn("questions","question_text","TEXT NULL"); await addColumn("questions","created_at","TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); }

  if (!await hasTable("evaluations")) await pool.query(`CREATE TABLE evaluations (id INT AUTO_INCREMENT PRIMARY KEY,interview_id INT NOT NULL UNIQUE,technical DECIMAL(5,2) DEFAULT 0,communication DECIMAL(5,2) DEFAULT 0,confidence DECIMAL(5,2) DEFAULT 0,problem_solving DECIMAL(5,2) DEFAULT 0,overall DECIMAL(5,2) DEFAULT 0,feedback TEXT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);
  else { await addColumn("evaluations","interview_id","INT NULL"); await addColumn("evaluations","student_id","INT NULL"); await addColumn("evaluations","technical","DECIMAL(5,2) DEFAULT 0"); await addColumn("evaluations","communication","DECIMAL(5,2) DEFAULT 0"); await addColumn("evaluations","confidence","DECIMAL(5,2) DEFAULT 0"); await addColumn("evaluations","problem_solving","DECIMAL(5,2) DEFAULT 0"); await addColumn("evaluations","overall","DECIMAL(5,2) DEFAULT 0"); await addColumn("evaluations","feedback","TEXT NULL"); await addColumn("evaluations","created_at","TIMESTAMP DEFAULT CURRENT_TIMESTAMP"); const ec=await columns("evaluations"); if(ec.has("student_id")){try{await pool.query("ALTER TABLE evaluations MODIFY COLUMN student_id INT NULL")}catch{}} }

  if (!await hasTable("interview_messages")) await pool.query(`CREATE TABLE interview_messages (id INT AUTO_INCREMENT PRIMARY KEY,interview_id INT NOT NULL,sender_id INT NOT NULL,message TEXT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`);

  console.log(`MySQL connected: ${config.database}`);
}

module.exports = pool;
module.exports.ensureDatabase = ensureDatabase;
