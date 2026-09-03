const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ==========================================
// مِداد | Database Setup
// ==========================================

// إنشاء مجلد قاعدة البيانات إذا لم يكن موجودًا
const databaseDir = path.join(__dirname, 'database');

if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}

const databasePath = path.join(databaseDir, 'medad.db');

const db = new Database(databasePath);

// إعدادات SQLite
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

console.log('==========================================');
console.log('        مِداد | Database Setup');
console.log('==========================================');
console.log(`Database: ${databasePath}`);

// ==========================================
// دالة التأكد من وجود عمود
// ==========================================

function columnExists(tableName, columnName) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();

  return columns.some(column => column.name === columnName);
}

// ==========================================
// إضافة عمود إذا لم يكن موجودًا
// ==========================================

function addColumnIfMissing(tableName, columnName, definition) {
  if (!columnExists(tableName, columnName)) {
    db.exec(`
      ALTER TABLE ${tableName}
      ADD COLUMN ${columnName} ${definition}
    `);

    console.log(`+ تمت إضافة العمود: ${tableName}.${columnName}`);
  }
}

// ==========================================
// إنشاء الجداول الأساسية
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    tags TEXT,
    category TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id)
      REFERENCES articles(id)
      ON DELETE CASCADE,
    FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS forum_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS forum_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id)
      REFERENCES forum_topics(id)
      ON DELETE CASCADE,
    FOREIGN KEY (user_id)
      REFERENCES users(id)
      ON DELETE CASCADE
  );
`);

// ==========================================
// توافق مع قاعدة البيانات القديمة
// ==========================================

// المقالات القديمة عندك كانت تحتوي على:
// id / title / content / created_at

// نضيف الأعمدة الجديدة فقط إذا كانت ناقصة
addColumnIfMissing('articles', 'image_url', 'TEXT');
addColumnIfMissing('articles', 'tags', 'TEXT');
addColumnIfMissing('articles', 'category', 'TEXT');

// ==========================================
// الفهارس - تحسين سرعة الموقع
// ==========================================

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_articles_created_at
  ON articles(created_at);

  CREATE INDEX IF NOT EXISTS idx_articles_category
  ON articles(category);

  CREATE INDEX IF NOT EXISTS idx_articles_title
  ON articles(title);

  CREATE INDEX IF NOT EXISTS idx_comments_article_id
  ON comments(article_id);

  CREATE INDEX IF NOT EXISTS idx_comments_user_id
  ON comments(user_id);

  CREATE INDEX IF NOT EXISTS idx_forum_topics_section
  ON forum_topics(section);

  CREATE INDEX IF NOT EXISTS idx_forum_topics_user_id
  ON forum_topics(user_id);

  CREATE INDEX IF NOT EXISTS idx_forum_replies_topic_id
  ON forum_replies(topic_id);

  CREATE INDEX IF NOT EXISTS idx_forum_replies_user_id
  ON forum_replies(user_id);

  CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);
`);

// ==========================================
// بيانات تجريبية للمقالات
// ==========================================

const articleCount = db
  .prepare('SELECT COUNT(*) AS total FROM articles')
  .get();

if (articleCount.total === 0) {
  const insertArticle = db.prepare(`
    INSERT INTO articles
    (title, content, image_url, tags, category)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    insertArticle.run(
      'أول مقال في مِداد',
      'ده أول مقال بيتخزن فعليًا في قاعدة البيانات.',
      null,
      'مداد,بداية,مقالات',
      'عام'
    );

    insertArticle.run(
      'البدايات دائمًا صعبة',
      'كل مبرمج كبير كان يومًا مبتدئًا. المهم إنك تبدأ وتكمل.',
      null,
      'برمجة,تعلم,مبتدئين',
      'برمجة'
    );
  });

  insertMany();

  console.log('✓ تمت إضافة المقالات التجريبية بنجاح');
} else {
  console.log(`✓ قاعدة البيانات تحتوي على ${articleCount.total} مقال`);
}

// ==========================================
// إحصائيات قاعدة البيانات
// ==========================================

const usersCount = db
  .prepare('SELECT COUNT(*) AS total FROM users')
  .get().total;

const commentsCount = db
  .prepare('SELECT COUNT(*) AS total FROM comments')
  .get().total;

const topicsCount = db
  .prepare('SELECT COUNT(*) AS total FROM forum_topics')
  .get().total;

const repliesCount = db
  .prepare('SELECT COUNT(*) AS total FROM forum_replies')
  .get().total;

console.log('');
console.log('------------------------------------------');
console.log('إحصائيات قاعدة البيانات');
console.log('------------------------------------------');
console.log(`المقالات   : ${articleCount.total}`);
console.log(`المستخدمون : ${usersCount}`);
console.log(`التعليقات  : ${commentsCount}`);
console.log(`المواضيع    : ${topicsCount}`);
console.log(`الردود      : ${repliesCount}`);
console.log('------------------------------------------');
console.log('✓ قاعدة البيانات جاهزة للعمل');
console.log('==========================================');

// إغلاق الاتصال
db.close();