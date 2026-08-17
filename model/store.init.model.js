const createstoretable = `
CREATE TABLE IF NOT EXISTS stores (
    store_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL,
    whatsapp_phone_number_id TEXT,
    whatsapp_access_token TEXT,
    whatsapp_waba_id TEXT,
    whatsapp_business_id TEXT,
    whatsapp_display_phone_number TEXT,
    whatsapp_verified_name TEXT,
    whatsapp_connected_at DATETIME,
    password TEXT NOT NULL,
    email TEXT UNIQUE,
    phone_number TEXT NOT NULL UNIQUE,
    district TEXT,
    state TEXT,
    address TEXT,
    cache_folder TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`

const createcustomertable = `
CREATE TABLE IF NOT EXISTS customers (
    customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    phone_number TEXT NOT NULL,
    total_orders INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    FOREIGN KEY (store_id) REFERENCES stores(store_id)
);`;

const createjobtable = `
CREATE TABLE IF NOT EXISTS print_jobs (
    job_id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL,

    customer_name TEXT,
    sender_phone TEXT NOT NULL,

    source TEXT NOT NULL,

    file_count INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,

    status TEXT DEFAULT 'pending',

    cost_of_job REAL DEFAULT 0,

    notes TEXT,
    print_settings TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id) REFERENCES stores(store_id)
);`;

const createjobfilestable = `
CREATE TABLE IF NOT EXISTS print_job_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,

    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT,
    pages INTEGER DEFAULT 0,

    FOREIGN KEY (job_id) REFERENCES print_jobs(job_id)
);`;

// Migrations for columns added after initial schema.
// Each statement is idempotent — the init runner silently ignores "duplicate column" errors.
const migrations = [
    `ALTER TABLE print_jobs ADD COLUMN customer_name TEXT`,
    `ALTER TABLE print_jobs ADD COLUMN notes TEXT`,
    `ALTER TABLE print_jobs ADD COLUMN print_settings TEXT`,
    `ALTER TABLE print_jobs ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    `ALTER TABLE print_jobs ADD COLUMN cost_of_job REAL DEFAULT 0`,

    // Performance indexes
    `CREATE INDEX IF NOT EXISTS idx_print_jobs_store_id ON print_jobs(store_id)`,
    `CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status)`,
    `CREATE INDEX IF NOT EXISTS idx_print_jobs_store_status ON print_jobs(store_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_print_job_files_job_id ON print_job_files(job_id)`,
    `CREATE INDEX IF NOT EXISTS idx_customers_store_phone ON customers(store_id, phone_number)`
];

module.exports = {
    createstoretable,
    createcustomertable,
    createjobtable,
    createjobfilestable,
    migrations
};
