const jwt=require("jsonwebtoken");
const pool=require("./db");
function sign(user){return jwt.sign({id:user.id,role:user.role,name:user.name,email:user.email},process.env.JWT_SECRET || 'dev-only-change-this-secret-ai-interview-platform',{expiresIn:"7d"});}
async function auth(req,res,next){try{const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({message:"Authentication required"});const p=jwt.verify(h.slice(7),process.env.JWT_SECRET || 'dev-only-change-this-secret-ai-interview-platform');const [rows]=await pool.query("SELECT id,name,email,role,phone,company,skills,bio,created_at FROM users WHERE id=?",[p.id]);if(!rows.length)return res.status(401).json({message:"User not found"});req.user=rows[0];next()}catch(e){return res.status(401).json({message:"Invalid or expired token"})}}
function role(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({message:"Access denied"})}
module.exports={sign,auth,role};
