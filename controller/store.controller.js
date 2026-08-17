const createstoreservice=require("../service/createstore.service");
const createStore = async (req, res) => {
    try {
        const { storename, phonenumber } = req.body;
        await createstoreservice(storename,phonenumber);        
        return res.status(200).json({
            success: true,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
}

module.exports={createStore};