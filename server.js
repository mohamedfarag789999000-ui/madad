'use strict';

const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const SqliteStore = require('better-sqlite3-session-store')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

/* =========================================================
   الإعدادات الأساسية
========================================================= */

const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATABASE_DIR = path.join(ROOT_DIR, 'database');
const DATABASE_FILE = path.join(DATABASE_DIR, 'medad.db');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction =
    process.env.NODE_ENV === 'production';
    if (isProduction) {
    app.set('trust proxy', 1);
}

/* =========================================================
   إنشاء المجلدات
========================================================= */

fs.mkdirSync(PUBLIC_DIR, {
    recursive: true
});

fs.mkdirSync(DATABASE_DIR, {
    recursive: true
});

fs.mkdirSync(UPLOADS_DIR, {
    recursive: true
});

/* =========================================================
   قاعدة البيانات
========================================================= */

const db = new Database(DATABASE_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

/* =========================================================
   إنشاء الجداول
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        tags TEXT,
        category TEXT,
        views INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY(article_id)
            REFERENCES articles(id)
            ON DELETE CASCADE,

        FOREIGN KEY(user_id)
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
        views INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forum_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        user_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY(topic_id)
            REFERENCES forum_topics(id)
            ON DELETE CASCADE,

        FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email
        ON users(email);

    CREATE INDEX IF NOT EXISTS idx_articles_created
        ON articles(created_at);

    CREATE INDEX IF NOT EXISTS idx_articles_category
        ON articles(category);

    CREATE INDEX IF NOT EXISTS idx_comments_article
        ON comments(article_id);

    CREATE INDEX IF NOT EXISTS idx_topics_section
        ON forum_topics(section);

    CREATE INDEX IF NOT EXISTS idx_replies_topic
        ON forum_replies(topic_id);
`);

/* =========================================================
   تحديث قاعدة البيانات القديمة
========================================================= */

function hasColumn(table, column) {
    const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all();

    return columns.some(
        item => item.name === column
    );
}

function addColumn(table, column, definition) {
    if (!hasColumn(table, column)) {
        db.exec(`
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        `);

        console.log(
            `تمت إضافة العمود: ${table}.${column}`
        );
    }
}

addColumn(
    'articles',
    'image_url',
    'TEXT'
);

addColumn(
    'articles',
    'tags',
    'TEXT'
);

addColumn(
    'articles',
    'category',
    'TEXT'
);

addColumn(
    'articles',
    'views',
    'INTEGER NOT NULL DEFAULT 0'
);

addColumn(
    'articles',
    'updated_at',
    'TEXT'
);

addColumn(
    'forum_topics',
    'views',
    'INTEGER NOT NULL DEFAULT 0'
);

/* =========================================================
   Express
========================================================= */

app.disable('x-powered-by');

app.use(
    express.json({
        limit: '10mb'
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '10mb'
    })
);

/* =========================================================
   SESSION
========================================================= */

const sessionStore = new SqliteStore({
    client: db,

    expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000
    }
});

app.use(
    session({
        name: 'medad.sid',

        store: sessionStore,

        secret: SESSION_SECRET,

        resave: false,

        saveUninitialized: false,

        rolling: true,

        cookie: {
            httpOnly: true,

            sameSite: 'lax',

            secure: isProduction,

            maxAge:
                1000 *
                60 *
                60 *
                24 *
                7
        }
    })
);

/* =========================================================
   أدوات مساعدة
========================================================= */

function cleanText(value, max = 10000) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .trim()
        .slice(0, max);
}

function normalizeEmail(value) {
    return cleanText(
        value,
        200
    ).toLowerCase();
}

function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isAdmin(req) {
    return (
        req.session &&
        req.session.adminLoggedIn === true
    );
}

function isUser(req) {
    return (
        req.session &&
        Number.isInteger(
            req.session.userId
        )
    );
}

/* =========================================================
   حماية الإدارة
========================================================= */

function requireAdmin(req, res, next) {
    if (!isAdmin(req)) {
        return res.status(401).json({
            success: false,
            error: 'صلاحية الإدارة مطلوبة'
        });
    }

    next();
}

/* =========================================================
   حماية المستخدم
========================================================= */

function requireUser(req, res, next) {
    if (!isUser(req)) {
        return res.status(401).json({
            success: false,
            error: 'يجب تسجيل الدخول أولًا'
        });
    }

    next();
}

/* =========================================================
   رفع الصور
========================================================= */

const allowedImageExtensions = [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif'
];

const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
];

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(
            null,
            UPLOADS_DIR
        );
    },

    filename: function (req, file, cb) {
        const extension =
            path.extname(
                file.originalname
            ).toLowerCase();

        if (
            !allowedImageExtensions.includes(
                extension
            )
        ) {
            return cb(
                new Error(
                    'نوع الصورة غير مسموح'
                )
            );
        }

        const random =
            Math.random()
                .toString(36)
                .substring(2, 10);

        const filename =
            `article-${Date.now()}-${random}${extension}`;

        cb(
            null,
            filename
        );
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {
        if (
            allowedMimeTypes.includes(
                file.mimetype
            )
        ) {
            return cb(
                null,
                true
            );
        }

        cb(
            new Error(
                'مسموح بصور JPG و PNG و WEBP و GIF فقط'
            )
        );
    }
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    '/api/health',
    (req, res) => {
        res.json({
            success: true,
            status: 'online',
            app: 'Madad',
            database: 'connected',
            session: 'sqlite',
            time: new Date().toISOString()
        });
    }
);

/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
    '/api/login',
    (req, res) => {
        const password =
            typeof req.body.password === 'string'
                ? req.body.password
                : '';

        if (!password) {
            return res.status(400).json({
                success: false,
                error: 'اكتب كلمة المرور'
            });
        }

        if (
            password !== ADMIN_PASSWORD
        ) {
            return res.status(401).json({
                success: false,
                error: 'كلمة المرور غير صحيحة'
            });
        }

        req.session.adminLoggedIn = true;

        req.session.adminLoginAt =
            new Date().toISOString();

        req.session.save(
            function (error) {
                if (error) {
                    console.error(
                        'SESSION SAVE ERROR:',
                        error
                    );

                    return res.status(500).json({
                        success: false,
                        error:
                            'تعذر حفظ جلسة الإدارة'
                    });
                }

                console.log(
                    'تم تسجيل دخول الإدارة بنجاح'
                );

                res.json({
                    success: true,
                    message:
                        'تم تسجيل الدخول بنجاح'
                });
            }
        );
    }
);

/* =========================================================
   فحص جلسة الإدارة
========================================================= */

app.get(
    '/api/check-login',
    (req, res) => {
        res.json({
            success: true,
            loggedIn: isAdmin(req)
        });
    }
);

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post(
    '/api/logout',
    (req, res) => {
        req.session.adminLoggedIn = false;
        req.session.adminLoginAt = null;

        req.session.save(
            function (error) {
                if (error) {
                    console.error(
                        'ADMIN LOGOUT ERROR:',
                        error
                    );

                    return res.status(500).json({
                        success: false,
                        error:
                            'تعذر تسجيل الخروج'
                    });
                }

                res.json({
                    success: true
                });
            }
        );
    }
);

/* =========================================================
   رفع صورة منفصل
========================================================= */

app.post(
    '/api/upload',
    requireAdmin,
    upload.single('image'),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'لم يتم اختيار صورة'
            });
        }

        const imageUrl =
            `/uploads/${req.file.filename}`;

        res.status(201).json({
            success: true,
            url: imageUrl,
            image_url: imageUrl,
            filename: req.file.filename
        });
    }
);

/* =========================================================
   USER REGISTER
========================================================= */

app.post(
    '/api/register',
    (req, res) => {
        try {
            const name =
                cleanText(
                    req.body.name,
                    100
                );

            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                typeof req.body.password === 'string'
                    ? req.body.password
                    : '';

            if (
                !name ||
                !email ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'كل البيانات مطلوبة'
                });
            }

            if (
                !validEmail(email)
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'البريد الإلكتروني غير صحيح'
                });
            }

            if (
                password.length < 6
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'كلمة المرور يجب أن تكون 6 أحرف على الأقل'
                });
            }

            const exists =
                db.prepare(
                    `
                    SELECT id
                    FROM users
                    WHERE email = ?
                    `
                ).get(email);

            if (exists) {
                return res.status(409).json({
                    success: false,
                    error:
                        'البريد الإلكتروني مستخدم بالفعل'
                });
            }

            const hashed =
                bcrypt.hashSync(
                    password,
                    12
                );

            const result =
                db.prepare(
                    `
                    INSERT INTO users
                    (
                        name,
                        email,
                        password
                    )
                    VALUES (?, ?, ?)
                    `
                ).run(
                    name,
                    email,
                    hashed
                );

            res.status(201).json({
                success: true,
                userId:
                    Number(
                        result.lastInsertRowid
                    ),
                message:
                    'تم إنشاء الحساب بنجاح'
            });

        } catch (error) {
            console.error(
                'REGISTER ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'حدث خطأ أثناء إنشاء الحساب'
            });
        }
    }
);

/* =========================================================
   USER LOGIN
========================================================= */

app.post(
    '/api/user-login',
    (req, res) => {
        try {
            const email =
                normalizeEmail(
                    req.body.email
                );

            const password =
                typeof req.body.password === 'string'
                    ? req.body.password
                    : '';

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    error:
                        'البريد الإلكتروني وكلمة المرور مطلوبان'
                });
            }

            const user =
                db.prepare(
                    `
                    SELECT *
                    FROM users
                    WHERE email = ?
                    `
                ).get(email);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    error:
                        'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                });
            }

            const valid =
                bcrypt.compareSync(
                    password,
                    user.password
                );

            if (!valid) {
                return res.status(401).json({
                    success: false,
                    error:
                        'البريد الإلكتروني أو كلمة المرور غير صحيحة'
                });
            }

            req.session.userId =
                user.id;

            req.session.userName =
                user.name;

            req.session.userEmail =
                user.email;

            req.session.save(
                function (error) {
                    if (error) {
                        console.error(
                            'USER SESSION ERROR:',
                            error
                        );

                        return res.status(500).json({
                            success: false,
                            error:
                                'تعذر حفظ جلسة المستخدم'
                        });
                    }

                    res.json({
                        success: true,

                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email
                        }
                    });
                }
            );

        } catch (error) {
            console.error(
                'USER LOGIN ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'حدث خطأ في تسجيل الدخول'
            });
        }
    }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
    '/api/current-user',
    (req, res) => {
        if (!isUser(req)) {
            return res.json({
                loggedIn: false,
                user: null
            });
        }

        const user =
            db.prepare(
                `
                SELECT
                    id,
                    name,
                    email,
                    created_at
                FROM users
                WHERE id = ?
                `
            ).get(
                req.session.userId
            );

        if (!user) {
            req.session.userId = null;
            req.session.userName = null;
            req.session.userEmail = null;

            return res.json({
                loggedIn: false,
                user: null
            });
        }

        res.json({
            loggedIn: true,
            user
        });
    }
);

/* =========================================================
   USER LOGOUT
========================================================= */

app.post(
    '/api/user-logout',
    (req, res) => {
        req.session.userId = null;
        req.session.userName = null;
        req.session.userEmail = null;

        req.session.save(
            function (error) {
                if (error) {
                    console.error(
                        'USER LOGOUT ERROR:',
                        error
                    );

                    return res.status(500).json({
                        success: false,
                        error:
                            'تعذر تسجيل الخروج'
                    });
                }

                res.json({
                    success: true
                });
            }
        );
    }
);

/* =========================================================
   ARTICLES - جميع المقالات
========================================================= */

app.get(
    '/api/articles',
    (req, res) => {
        try {
            const search =
                cleanText(
                    req.query.search,
                    200
                );

            const category =
                cleanText(
                    req.query.category,
                    100
                );

            let articles;

            if (search) {
                const keyword =
                    `%${search}%`;

                articles =
                    db.prepare(
                        `
                        SELECT *
                        FROM articles
                        WHERE
                            title LIKE ?
                            OR content LIKE ?
                            OR tags LIKE ?
                            OR category LIKE ?
                        ORDER BY id DESC
                        `
                    ).all(
                        keyword,
                        keyword,
                        keyword,
                        keyword
                    );

            } else if (
                category &&
                category !== 'الكل'
            ) {
                articles =
                    db.prepare(
                        `
                        SELECT *
                        FROM articles
                        WHERE category = ?
                        ORDER BY id DESC
                        `
                    ).all(
                        category
                    );

            } else {
                articles =
                    db.prepare(
                        `
                        SELECT *
                        FROM articles
                        ORDER BY id DESC
                        `
                    ).all();
            }

            res.json(
                articles
            );

        } catch (error) {
            console.error(
                'ARTICLES ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل المقالات'
            });
        }
    }
);

/* =========================================================
   ARTICLE - مقال واحد
========================================================= */

app.get(
    '/api/articles/:id',
    (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم المقال غير صحيح'
                });
            }

            const article =
                db.prepare(
                    `
                    SELECT *
                    FROM articles
                    WHERE id = ?
                    `
                ).get(id);

            if (!article) {
                return res.status(404).json({
                    success: false,
                    error:
                        'المقال غير موجود'
                });
            }

            db.prepare(
                `
                UPDATE articles
                SET views =
                    COALESCE(views, 0) + 1
                WHERE id = ?
                `
            ).run(id);

            article.views =
                (article.views || 0) + 1;

            res.json(
                article
            );

        } catch (error) {
            console.error(
                'ARTICLE ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل المقال'
            });
        }
    }
);

/* =========================================================
   CREATE ARTICLE
========================================================= */

app.post(
    '/api/articles',
    requireAdmin,
    upload.single('image'),
    (req, res) => {
        try {
            const title =
                cleanText(
                    req.body.title,
                    300
                );

            const content =
                cleanText(
                    req.body.content,
                    100000
                );

            const tags =
                cleanText(
                    req.body.tags,
                    1000
                );

            const category =
                cleanText(
                    req.body.category,
                    100
                );

            let imageUrl =
                cleanText(
                    req.body.image_url,
                    2000
                );

            if (req.file) {
                imageUrl =
                    `/uploads/${req.file.filename}`;
            }

            if (
                !title ||
                !content
            ) {
                if (req.file) {
                    try {
                        fs.unlinkSync(
                            req.file.path
                        );
                    } catch {}
                }

                return res.status(400).json({
                    success: false,
                    error:
                        'العنوان والمحتوى مطلوبان'
                });
            }

            const result =
                db.prepare(
                    `
                    INSERT INTO articles
                    (
                        title,
                        content,
                        image_url,
                        tags,
                        category,
                        views,
                        updated_at
                    )
                    VALUES
                    (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
                    `
                ).run(
                    title,
                    content,
                    imageUrl || null,
                    tags || null,
                    category || 'عام'
                );

            res.status(201).json({
                success: true,

                id:
                    Number(
                        result.lastInsertRowid
                    ),

                image_url:
                    imageUrl || null,

                message:
                    'تم نشر المقال بنجاح'
            });

        } catch (error) {
            console.error(
                'CREATE ARTICLE ERROR:',
                error
            );

            if (req.file) {
                try {
                    fs.unlinkSync(
                        req.file.path
                    );
                } catch {}
            }

            res.status(500).json({
                success: false,
                error:
                    'تعذر نشر المقال'
            });
        }
    }
);

/* =========================================================
   DELETE ARTICLE
========================================================= */

app.delete(
    '/api/articles/:id',
    requireAdmin,
    (req, res) => {
        try {
            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(id) ||
                id <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم المقال غير صحيح'
                });
            }

            const article =
                db.prepare(
                    `
                    SELECT *
                    FROM articles
                    WHERE id = ?
                    `
                ).get(id);

            if (!article) {
                return res.status(404).json({
                    success: false,
                    error:
                        'المقال غير موجود'
                });
            }

            db.prepare(
                `
                DELETE FROM articles
                WHERE id = ?
                `
            ).run(id);

            if (
                article.image_url &&
                article.image_url.startsWith(
                    '/uploads/'
                )
            ) {
                const filename =
                    path.basename(
                        article.image_url
                    );

                const imagePath =
                    path.join(
                        UPLOADS_DIR,
                        filename
                    );

                if (
                    fs.existsSync(
                        imagePath
                    )
                ) {
                    try {
                        fs.unlinkSync(
                            imagePath
                        );
                    } catch (error) {
                        console.error(
                            'IMAGE DELETE ERROR:',
                            error
                        );
                    }
                }
            }

            res.json({
                success: true,
                message:
                    'تم حذف المقال'
            });

        } catch (error) {
            console.error(
                'DELETE ARTICLE ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر حذف المقال'
            });
        }
    }
);

/* =========================================================
   COMMENTS - عرض التعليقات
========================================================= */

app.get(
    '/api/articles/:id/comments',
    (req, res) => {
        try {
            const articleId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(articleId) ||
                articleId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم المقال غير صحيح'
                });
            }

            const comments =
                db.prepare(
                    `
                    SELECT *
                    FROM comments
                    WHERE article_id = ?
                    ORDER BY id DESC
                    `
                ).all(
                    articleId
                );

            res.json(
                comments
            );

        } catch (error) {
            console.error(
                'COMMENTS GET ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل التعليقات'
            });
        }
    }
);

/* =========================================================
   COMMENTS - إضافة تعليق
========================================================= */

app.post(
    '/api/articles/:id/comments',
    requireUser,
    (req, res) => {
        try {
            const articleId =
                Number(
                    req.params.id
                );

            const content =
                cleanText(
                    req.body.content,
                    5000
                );

            if (
                !Number.isInteger(articleId) ||
                articleId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم المقال غير صحيح'
                });
            }

            if (!content) {
                return res.status(400).json({
                    success: false,
                    error:
                        'اكتب تعليقًا'
                });
            }

            const article =
                db.prepare(
                    `
                    SELECT id
                    FROM articles
                    WHERE id = ?
                    `
                ).get(articleId);

            if (!article) {
                return res.status(404).json({
                    success: false,
                    error:
                        'المقال غير موجود'
                });
            }

            const result =
                db.prepare(
                    `
                    INSERT INTO comments
                    (
                        article_id,
                        user_id,
                        user_name,
                        content
                    )
                    VALUES (?, ?, ?, ?)
                    `
                ).run(
                    articleId,
                    req.session.userId,
                    req.session.userName,
                    content
                );

            res.status(201).json({
                success: true,
                id:
                    Number(
                        result.lastInsertRowid
                    )
            });

        } catch (error) {
            console.error(
                'CREATE COMMENT ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر إضافة التعليق'
            });
        }
    }
);

/* =========================================================
   FORUM - جميع المواضيع
========================================================= */

app.get(
    '/api/forum/topics',
    (req, res) => {
        try {
            const topics =
                db.prepare(
                    `
                    SELECT
                        t.*,

                        (
                            SELECT COUNT(*)
                            FROM forum_replies r
                            WHERE r.topic_id = t.id
                        ) AS replies_count

                    FROM forum_topics t

                    ORDER BY t.id DESC
                    `
                ).all();

            res.json(
                topics
            );

        } catch (error) {
            console.error(
                'FORUM TOPICS ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل مواضيع المنتدى'
            });
        }
    }
);

/* =========================================================
   FORUM - موضوع واحد
========================================================= */

app.get(
    '/api/forum/topics/:id',
    (req, res) => {
        try {
            const topicId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(topicId) ||
                topicId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم الموضوع غير صحيح'
                });
            }

            const topic =
                db.prepare(
                    `
                    SELECT *
                    FROM forum_topics
                    WHERE id = ?
                    `
                ).get(topicId);

            if (!topic) {
                return res.status(404).json({
                    success: false,
                    error:
                        'الموضوع غير موجود'
                });
            }

            db.prepare(
                `
                UPDATE forum_topics
                SET views =
                    COALESCE(views, 0) + 1
                WHERE id = ?
                `
            ).run(topicId);

            topic.views =
                (topic.views || 0) + 1;

            res.json(
                topic
            );

        } catch (error) {
            console.error(
                'FORUM TOPIC ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل الموضوع'
            });
        }
    }
);

/* =========================================================
   FORUM - إنشاء موضوع
========================================================= */

app.post(
    '/api/forum/topics',
    requireUser,
    (req, res) => {
        try {
            const section =
                cleanText(
                    req.body.section,
                    100
                );

            const title =
                cleanText(
                    req.body.title,
                    300
                );

            const content =
                cleanText(
                    req.body.content,
                    10000
                );

            if (
                !section ||
                !title ||
                !content
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'كل البيانات مطلوبة'
                });
            }

            const result =
                db.prepare(
                    `
                    INSERT INTO forum_topics
                    (
                        section,
                        title,
                        content,
                        user_id,
                        user_name
                    )
                    VALUES (?, ?, ?, ?, ?)
                    `
                ).run(
                    section,
                    title,
                    content,
                    req.session.userId,
                    req.session.userName
                );

            res.status(201).json({
                success: true,
                id:
                    Number(
                        result.lastInsertRowid
                    )
            });

        } catch (error) {
            console.error(
                'CREATE TOPIC ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر إنشاء الموضوع'
            });
        }
    }
);

/* =========================================================
   FORUM - الردود
========================================================= */

app.get(
    '/api/forum/topics/:id/replies',
    (req, res) => {
        try {
            const topicId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(topicId) ||
                topicId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم الموضوع غير صحيح'
                });
            }

            const topic =
                db.prepare(
                    `
                    SELECT id
                    FROM forum_topics
                    WHERE id = ?
                    `
                ).get(topicId);

            if (!topic) {
                return res.status(404).json({
                    success: false,
                    error:
                        'الموضوع غير موجود'
                });
            }

            const replies =
                db.prepare(
                    `
                    SELECT *
                    FROM forum_replies
                    WHERE topic_id = ?
                    ORDER BY id ASC
                    `
                ).all(
                    topicId
                );

            res.json(
                replies
            );

        } catch (error) {
            console.error(
                'FORUM REPLIES ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل الردود'
            });
        }
    }
);

/* =========================================================
   FORUM - إضافة رد
========================================================= */

app.post(
    '/api/forum/topics/:id/replies',
    requireUser,
    (req, res) => {
        try {
            const topicId =
                Number(
                    req.params.id
                );

            const content =
                cleanText(
                    req.body.content,
                    10000
                );

            if (
                !Number.isInteger(topicId) ||
                topicId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        'رقم الموضوع غير صحيح'
                });
            }

            if (!content) {
                return res.status(400).json({
                    success: false,
                    error:
                        'اكتب الرد'
                });
            }

            const topic =
                db.prepare(
                    `
                    SELECT id
                    FROM forum_topics
                    WHERE id = ?
                    `
                ).get(topicId);

            if (!topic) {
                return res.status(404).json({
                    success: false,
                    error:
                        'الموضوع غير موجود'
                });
            }

            const result =
                db.prepare(
                    `
                    INSERT INTO forum_replies
                    (
                        topic_id,
                        user_id,
                        user_name,
                        content
                    )
                    VALUES (?, ?, ?, ?)
                    `
                ).run(
                    topicId,
                    req.session.userId,
                    req.session.userName,
                    content
                );

            res.status(201).json({
                success: true,
                id:
                    Number(
                        result.lastInsertRowid
                    )
            });

        } catch (error) {
            console.error(
                'CREATE REPLY ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر إضافة الرد'
            });
        }
    }
);

/* =========================================================
   ADMIN STATS
========================================================= */

app.get(
    '/api/admin/stats',
    requireAdmin,
    (req, res) => {
        try {
            const users =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM users
                    `
                ).get().count;

            const articles =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM articles
                    `
                ).get().count;

            const comments =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM comments
                    `
                ).get().count;

            const topics =
                db.prepare(
                    `
                    SELECT COUNT(*) AS count
                    FROM forum_topics
                    `
                ).get().count;

            const views =
                db.prepare(
                    `
                    SELECT
                        COALESCE(
                            SUM(views),
                            0
                        ) AS count
                    FROM articles
                    `
                ).get().count;

            res.json({
                success: true,

                stats: {
                    users,
                    articles,
                    comments,
                    topics,
                    views
                }
            });

        } catch (error) {
            console.error(
                'ADMIN STATS ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل الإحصائيات'
            });
        }
    }
);

/* =========================================================
   ADMIN ARTICLES
========================================================= */

app.get(
    '/api/admin/articles',
    requireAdmin,
    (req, res) => {
        try {
            const articles =
                db.prepare(
                    `
                    SELECT *
                    FROM articles
                    ORDER BY id DESC
                    `
                ).all();

            res.json({
                success: true,
                articles
            });

        } catch (error) {
            console.error(
                'ADMIN ARTICLES ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل المقالات'
            });
        }
    }
);

/* =========================================================
   ADMIN USERS
========================================================= */

app.get(
    '/api/admin/users',
    requireAdmin,
    (req, res) => {
        try {
            const users =
                db.prepare(
                    `
                    SELECT
                        id,
                        name,
                        email,
                        created_at
                    FROM users
                    ORDER BY id DESC
                    `
                ).all();

            res.json({
                success: true,
                users
            });

        } catch (error) {
            console.error(
                'ADMIN USERS ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    'تعذر تحميل المستخدمين'
            });
        }
    }
);

/* =========================================================
   الملفات العامة
========================================================= */

app.use(
    express.static(
        PUBLIC_DIR,
        {
            extensions: ['html'],

            maxAge:
                isProduction
                    ? '1d'
                    : 0
        }
    )
);

/* =========================================================
   API غير موجود
========================================================= */

app.use(
    '/api',
    (req, res) => {
        res.status(404).json({
            success: false,
            error:
                'API غير موجود'
        });
    }
);

/* =========================================================
   معالجة أخطاء Multer / Server
========================================================= */

app.use(
    (error, req, res, next) => {
        console.error(
            'SERVER ERROR:',
            error
        );

        if (
            error &&
            error.code === 'LIMIT_FILE_SIZE'
        ) {
            return res.status(400).json({
                success: false,
                error:
                    'حجم الصورة أكبر من 10MB'
            });
        }

        if (
            error &&
            error.message &&
            (
                error.message.includes(
                    'نوع الصورة'
                ) ||
                error.message.includes(
                    'مسموح بصور'
                )
            )
        ) {
            return res.status(400).json({
                success: false,
                error:
                    error.message
            });
        }

        res.status(500).json({
            success: false,
            error:
                'حدث خطأ في السيرفر'
        });
    }
);

/* =========================================================
   START
========================================================= */

const server =
   app.listen(
    PORT,
    '0.0.0.0',
        () => {
            console.log('');

            console.log(
                '======================================'
            );

            console.log(
                '             مِداد MADAD'
            );

            console.log(
                '======================================'
            );

            console.log(
                `Server: http://localhost:${PORT}`
            );

            console.log(
                `Database: ${DATABASE_FILE}`
            );

            console.log(
                `Uploads: ${UPLOADS_DIR}`
            );

            console.log(
                'Session Store: SQLite'
            );

            console.log(
                'Admin Login: READY'
            );

            console.log(
                'Image Upload: READY'
            );

            console.log(
                'Articles API: READY'
            );

            console.log(
                'Users API: READY'
            );

            console.log(
                'Forum API: READY'
            );

            console.log(
                '======================================'
            );

            console.log('');
        }
    );

/* =========================================================
   إغلاق آمن
========================================================= */

function shutdown() {
    console.log(
        '\nجارٍ إغلاق السيرفر...'
    );

    server.close(
        () => {
            try {
                db.close();

                console.log(
                    'تم إغلاق قاعدة البيانات.'
                );

                console.log(
                    'تم إيقاف السيرفر.'
                );

                process.exit(0);

            } catch (error) {
                console.error(
                    error
                );

                process.exit(1);
            }
        }
    );
}

process.on(
    'SIGINT',
    shutdown
);

process.on(
    'SIGTERM',
    shutdown
);