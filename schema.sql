CREATE DATABASE IF NOT EXISTS ai_interview_platform;
USE ai_interview_platform;

SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS interview_messages;
DROP TABLE IF EXISTS evaluations;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS interviews;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','hr') NOT NULL,
  phone VARCHAR(30) DEFAULT NULL,
  company VARCHAR(150) DEFAULT NULL,
  skills TEXT DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE interviews (
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
) ENGINE=InnoDB;

CREATE TABLE questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role_name VARCHAR(150) DEFAULT 'General',
  difficulty VARCHAR(50) DEFAULT 'Medium',
  question_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE evaluations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  interview_id INT NOT NULL UNIQUE,
  technical DECIMAL(5,2) DEFAULT 0,
  communication DECIMAL(5,2) DEFAULT 0,
  confidence DECIMAL(5,2) DEFAULT 0,
  problem_solving DECIMAL(5,2) DEFAULT 0,
  overall DECIMAL(5,2) DEFAULT 0,
  feedback TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE interview_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  interview_id INT NOT NULL,
  sender_id INT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (interview_id) REFERENCES interviews(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_interviews_student ON interviews(student_id);
CREATE INDEX idx_interviews_hr ON interviews(hr_id);
CREATE INDEX idx_interviews_scheduled ON interviews(scheduled_at);
CREATE INDEX idx_questions_user ON questions(user_id);
CREATE INDEX idx_evaluations_interview ON evaluations(interview_id);
CREATE INDEX idx_messages_interview ON interview_messages(interview_id);

SELECT 'AI Interview Platform database is ready.' AS message;
