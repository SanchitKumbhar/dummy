const express=require("express");
const middleware=require("../middleware/auth.middleware");
const pendingJobsSync=require("../controller/pending.sync.controller");

const router =express.Router();

router.get("/v1/pending-jobs",middleware,pendingJobsSync);

module.exports=router;

