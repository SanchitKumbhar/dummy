const express=require("express");
const { createStore } = require("../controller/store.controller");

const router=express.Router();

router.post("/v1/create-store",createStore);

module.exports=router;