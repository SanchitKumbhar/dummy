const express = require("express");
const middleware = require("../middleware/auth.middleware");
const { customerController } = require("../controller/customer.controller");

const router = express.Router();

router.get("/v1/list", middleware, customerController);

module.exports = router;
