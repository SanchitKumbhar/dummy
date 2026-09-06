const createstoreservice=require("../service/createstore.service");
const createStore = async (req, res) => {
    try {
        const { storename, phonenumber, password } = req.body;
        const result = await createstoreservice(storename, phonenumber, password);
        return res.status(result.status).json(result);
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}

module.exports={createStore};