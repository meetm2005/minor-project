require("dotenv").config();
const express=require("express"),cors=require("cors"),http=require("http"),bcrypt=require("bcryptjs"),{Server}=require("socket.io"),crypto=require("crypto");
const db=require("./db"), pool=db, {sign,auth,role}=require("./auth");
const app=express();const server=http.createServer(app);
const allowedOrigin=process.env.FRONTEND_URL||"http://localhost:5173";
const io=new Server(server,{cors:{origin:allowedOrigin,methods:["GET","POST"]}});
app.use(cors({origin:allowedOrigin}));app.use(express.json());
app.get("/api/health",(req,res)=>res.json({ok:true,service:"AI Interview Platform API",time:new Date().toISOString()}));
app.post("/api/auth/register",async(req,res)=>{try{const {name,email,password,role:r,phone,company}=req.body;const cleanName=String(name||"").trim();const cleanEmail=String(email||"").trim().toLowerCase();const cleanRole=String(r||"student").trim().toLowerCase();if(!cleanName||!cleanEmail||!password||!["student","hr"].includes(cleanRole))return res.status(400).json({message:"Name, email, password and valid role are required"});if(password.length<6)return res.status(400).json({message:"Password must be at least 6 characters"});const [exists]=await pool.query("SELECT id FROM users WHERE email=?",[cleanEmail]);if(exists.length)return res.status(409).json({message:"Email is already registered"});const hash=await bcrypt.hash(password,10);const [result]=await pool.query("INSERT INTO users(name,email,password_hash,role,phone,company) VALUES(?,?,?,?,?,?)",[cleanName,cleanEmail,hash,cleanRole,phone||null,company||null]);const user={id:result.insertId,name:cleanName,email:cleanEmail,role:cleanRole,phone:phone||null,company:company||null};res.status(201).json({message:"Registration successful. You can now sign in.",user,token:null})}catch(e){console.error("REGISTER ERROR:",e);res.status(500).json({message:"Registration failed. Check MySQL/database setup.",error:process.env.NODE_ENV==="production"?"Database error":e.message})}});
app.post("/api/auth/login",async(req,res)=>{
  try{
    const email=String(req.body.email||"").trim().toLowerCase();
    const loginPassword=String(req.body.password||"");
    const requestedRole=String(req.body.role||"student").trim().toLowerCase();
    if(!email||!loginPassword||!["student","hr"].includes(requestedRole)){
      return res.status(400).json({message:"Email, password and valid role are required"});
    }

    const [rows]=await pool.query("SELECT * FROM users WHERE LOWER(email)=? LIMIT 1",[email]);
    if(!rows.length)return res.status(401).json({message:"Account not found. Please register first."});

    const account=rows[0];
    if(String(account.role).toLowerCase()!==requestedRole){
      return res.status(401).json({message:`This account is registered as ${account.role}. Please select ${account.role} to sign in.`});
    }

    // Support both the current password_hash column and older databases that used password.
    const storedHash=account.password_hash || account.password;
    if(!storedHash)return res.status(401).json({message:"Password is not configured for this account. Please register again."});

    const ok=await bcrypt.compare(loginPassword,storedHash);
    if(!ok)return res.status(401).json({message:"Incorrect password"});

    // If an old database used `password`, migrate the verified hash to password_hash.
    if(!account.password_hash && account.password){
      try{await pool.query("UPDATE users SET password_hash=? WHERE id=?",[storedHash,account.id]);}catch{}
    }

    const {password_hash,password,...safe}=account;
    res.json({token:sign(safe),user:safe});
  }catch(e){
    console.error("LOGIN ERROR:",e);
    res.status(500).json({message:"Sign in failed. Check MySQL/database setup.",error:process.env.NODE_ENV==="production"?"Database error":e.message});
  }
});
app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));
app.put("/api/profile",auth,async(req,res)=>{try{const {name,phone,company,skills,bio}=req.body;await pool.query("UPDATE users SET name=?,phone=?,company=?,skills=?,bio=? WHERE id=?",[name,phone||null,company||null,skills||null,bio||null,req.user.id]);const [rows]=await pool.query("SELECT id,name,email,role,phone,company,skills,bio,created_at FROM users WHERE id=?",[req.user.id]);res.json({user:rows[0]})}catch(e){res.status(500).json({message:"Profile update failed"})}});
app.get("/api/students",auth,role("hr"),async(req,res)=>{const [rows]=await pool.query("SELECT id,name,email,phone,skills,bio,created_at FROM users WHERE role='student' ORDER BY created_at DESC");res.json({students:rows})});
app.get("/api/interviews",auth,async(req,res)=>{const q=req.user.role==="student"?`SELECT i.*,u.name student_name,h.name hr_name,e.overall FROM interviews i JOIN users u ON u.id=i.student_id JOIN users h ON h.id=i.hr_id LEFT JOIN evaluations e ON e.interview_id=i.id WHERE i.student_id=? ORDER BY i.scheduled_at DESC`:`SELECT i.*,u.name student_name,h.name hr_name,e.overall FROM interviews i JOIN users u ON u.id=i.student_id JOIN users h ON h.id=i.hr_id LEFT JOIN evaluations e ON e.interview_id=i.id WHERE i.hr_id=? ORDER BY i.scheduled_at DESC`;const [rows]=await pool.query(q,[req.user.id]);res.json({interviews:rows})});
app.post("/api/interviews",auth,role("hr"),async(req,res)=>{try{let {studentId,title,interviewType,scheduledAt,duration}=req.body;studentId=Number(studentId);title=String(title||"").trim();if(!studentId||!title||!scheduledAt)return res.status(400).json({message:"Student, title and schedule are required"});const [student]=await pool.query("SELECT id FROM users WHERE id=? AND role='student' LIMIT 1",[studentId]);if(!student.length)return res.status(400).json({message:"Selected student was not found"});const rawSchedule=String(scheduledAt).trim();if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawSchedule) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(rawSchedule))return res.status(400).json({message:"Invalid interview date and time"});const mysqlDate=rawSchedule.replace("T"," ").slice(0,19);const roomId=crypto.randomUUID();const [r]=await pool.query("INSERT INTO interviews(student_id,hr_id,title,interview_type,scheduled_at,duration_minutes,status,room_id) VALUES(?,?,?,?,?,?,?,?)",[studentId,req.user.id,title,interviewType||"Technical",mysqlDate,Number(duration)||30,"scheduled",roomId]);res.status(201).json({id:r.insertId,roomId,message:"Interview scheduled successfully"})}catch(e){console.error("SCHEDULE ERROR:",e);res.status(500).json({message:"Could not schedule interview",error:e.message})}});
app.patch("/api/interviews/:id/status",auth,async(req,res)=>{try{const {status}=req.body;if(!["scheduled","live","completed","cancelled"].includes(status))return res.status(400).json({message:"Invalid status"});const [r]=await pool.query("UPDATE interviews SET status=? WHERE id=? AND (student_id=? OR hr_id=?)",[status,req.params.id,req.user.id,req.user.id]);if(!r.affectedRows)return res.status(404).json({message:"Interview not found"});res.json({message:"Status updated"})}catch(e){res.status(500).json({message:"Status update failed"})}});
app.get("/api/interviews/:id",auth,async(req,res)=>{const [rows]=await pool.query(`SELECT i.*,u.name student_name,u.email student_email,h.name hr_name,h.email hr_email,e.technical,e.communication,e.confidence,e.problem_solving,e.overall,e.feedback FROM interviews i JOIN users u ON u.id=i.student_id JOIN users h ON h.id=i.hr_id LEFT JOIN evaluations e ON e.interview_id=i.id WHERE i.id=? AND (i.student_id=? OR i.hr_id=?)`,[req.params.id,req.user.id,req.user.id]);if(!rows.length)return res.status(404).json({message:"Interview not found"});res.json({interview:rows[0]})});
app.post("/api/evaluations",auth,role("hr"),async(req,res)=>{try{const {interviewId,technical,communication,confidence,problemSolving,feedback}=req.body;const nums=[technical,communication,confidence,problemSolving].map(Number);if(nums.some(n=>n<0||n>100||Number.isNaN(n)))return res.status(400).json({message:"Scores must be 0-100"});const overall=Math.round(nums.reduce((a,b)=>a+b,0)/4);const [iv]=await pool.query("SELECT student_id FROM interviews WHERE id=? AND hr_id=? LIMIT 1",[interviewId,req.user.id]); if(!iv.length)return res.status(404).json({message:"Interview not found or not assigned to you"}); const [ec]=await pool.query("SHOW COLUMNS FROM evaluations"); const hasStudent=ec.some(c=>c.Field==="student_id"); const sql=hasStudent?`INSERT INTO evaluations(interview_id,student_id,technical,communication,confidence,problem_solving,overall,feedback) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE technical=VALUES(technical),communication=VALUES(communication),confidence=VALUES(confidence),problem_solving=VALUES(problem_solving),overall=VALUES(overall),feedback=VALUES(feedback)`:`INSERT INTO evaluations(interview_id,technical,communication,confidence,problem_solving,overall,feedback) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE technical=VALUES(technical),communication=VALUES(communication),confidence=VALUES(confidence),problem_solving=VALUES(problem_solving),overall=VALUES(overall),feedback=VALUES(feedback)`; const params=hasStudent?[interviewId,iv[0].student_id,...nums,overall,feedback||""]:[interviewId,...nums,overall,feedback||""]; await pool.query(sql,params);await pool.query("UPDATE interviews SET status='completed' WHERE id=?",[interviewId]);res.json({message:"Evaluation saved",overall})}catch(e){res.status(500).json({message:"Evaluation failed",error:e.message})}});
app.get("/api/dashboard/student",auth,role("student"),async(req,res)=>{const [[a]]=await pool.query("SELECT COUNT(*) total,COALESCE(SUM(status='completed'),0) completed,COALESCE(SUM(status='scheduled'),0) upcoming FROM interviews WHERE student_id=?",[req.user.id]);const [[s]]=await pool.query("SELECT COALESCE(ROUND(AVG(e.overall)),0) average FROM evaluations e JOIN interviews i ON i.id=e.interview_id WHERE i.student_id=?",[req.user.id]);res.json({stats:{...a,average:s.average}})});
app.get("/api/dashboard/hr",auth,role("hr"),async(req,res)=>{const [[c]]=await pool.query("SELECT COUNT(*) total FROM users WHERE role='student'");const [[a]]=await pool.query("SELECT COUNT(*) total FROM interviews WHERE hr_id=?",[req.user.id]);const [[p]]=await pool.query("SELECT COUNT(*) total FROM interviews WHERE hr_id=? AND status='scheduled'",[req.user.id]);const [[d]]=await pool.query("SELECT COUNT(*) total FROM interviews WHERE hr_id=? AND status='completed'",[req.user.id]);res.json({stats:{candidates:c.total,total:a.total,scheduled:p.total,completed:d.total}})});
const fallback={
  frontend:["Explain the difference between state and props in React.","What is the virtual DOM and why is it useful?","How would you optimize a React application with many components?","How do you handle API loading, success and error states in a frontend application?","Explain controlled and uncontrolled components in React.","What are React hooks? Explain useState and useEffect.","How would you make a responsive dashboard for mobile and desktop?","How do you protect routes in a React application?"] ,
  backend:["What is middleware in Express.js and where would you use it?","Explain JWT authentication and how you would secure an API.","How does indexing improve MySQL query performance?","What makes an API RESTful?","How would you validate and sanitize incoming API data?","Explain the difference between authentication and authorization.","How would you handle errors consistently in an Express application?","How would you design a users and interviews relational database?"] ,
  general:["Tell me about yourself.","Why are you interested in this role?","What is your biggest technical strength?","Describe a difficult problem you solved and how you approached it.","How do you handle pressure before an important interview?","Describe a project you are proud of.","How do you learn a new technology?","Where do you see yourself professionally in the next five years?"]
};

async function gemini(prompt){
  if(!process.env.GEMINI_API_KEY)return null;
  try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key="+process.env.GEMINI_API_KEY,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})});
    if(!r.ok)return null;
    const data=await r.json();
    return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("\n")||null;
  }catch(e){console.log("Gemini fallback:",e.message);return null}
}

app.post("/api/ai/questions",auth,async(req,res)=>{
  try{
    const {roleName="General",difficulty="Medium",count=5}=req.body;
    const safeCount=Math.min(Math.max(Number(count)||5,1),10);
    const key=roleName.toLowerCase().includes("front")?"frontend":roleName.toLowerCase().includes("back")||roleName.toLowerCase().includes("full")?"backend":"general";
    let source="local";
    let qs=null;
    const generated=await gemini(`Generate ${safeCount} ${difficulty} interview questions for a ${roleName} candidate. Return only one question per line, without numbering, markdown or answers.`);
    if(generated){
      qs=generated.split("\n").map(x=>x.replace(/^\s*[-*\d.)]+\s*/,"").trim()).filter(Boolean).slice(0,safeCount);
      if(qs.length)source="gemini";
    }
    if(!qs?.length)qs=fallback[key].slice(0,safeCount);
    try { for(const q of qs) await pool.query("INSERT INTO questions(user_id,role_name,difficulty,question_text) VALUES(?,?,?,?)",[req.user.id,roleName,difficulty,q]); } catch (dbErr) { console.error("QUESTION SAVE ERROR:", dbErr.message); }
    res.json({questions:qs,source});
  }catch(e){console.error(e);res.status(500).json({message:"Question generation failed",error:e.message})}
});

app.post("/api/ai/evaluate-answer",auth,async(req,res)=>{
  try{
    const {question="",answer="",roleName="General"}=req.body;
    if(!question.trim()||!answer.trim())return res.status(400).json({message:"Question and answer are required"});
    const generated=await gemini(`Evaluate this interview answer. Role: ${roleName}. Question: ${question}. Candidate answer: ${answer}. Return JSON only with keys score (0-100), strengths (array of 2-3 short strings), improvements (array of 2-3 short strings), feedback (short paragraph).`);
    if(generated){
      const cleaned=generated.replace(/```json|```/g,"").trim();
      try{return res.json({source:"gemini",evaluation:JSON.parse(cleaned)})}catch{}
    }
    const words=answer.trim().split(/\s+/).filter(Boolean).length;
    const score=Math.min(95,Math.max(35,45+Math.min(words,80)));
    res.json({source:"local",evaluation:{score,strengths:["Answer addresses the question","Shows willingness to explain your approach"],improvements:["Add a concrete project example","Explain the result or measurable outcome"],feedback:"Your answer has a useful starting point. Add a specific example, explain your reasoning step by step, and finish with the result to make it stronger."}});
  }catch(e){res.status(500).json({message:"Answer evaluation failed",error:e.message})}
});

app.get("/api/history",auth,role("student"),async(req,res)=>{const [rows]=await pool.query(`SELECT i.id,i.title,i.interview_type,i.scheduled_at,i.status,e.technical,e.communication,e.confidence,e.problem_solving,e.overall,e.feedback FROM interviews i LEFT JOIN evaluations e ON e.interview_id=i.id WHERE i.student_id=? ORDER BY i.scheduled_at DESC`,[req.user.id]);res.json({history:rows})});
io.on("connection",socket=>{
  socket.on("join-room",room=>{socket.join(room);const peers=io.sockets.adapter.rooms.get(room);if(peers&&peers.size>1)socket.to(room).emit("peer-joined")});
  socket.on("signal",({room,data})=>socket.to(room).emit("signal",data));
  socket.on("chat",({room,message,user})=>io.to(room).emit("chat",{message,user}));
  socket.on("leave-room",room=>socket.leave(room));
});
const PORT=process.env.PORT||5000;
(async()=>{
  try{
    await db.ensureDatabase();
    server.listen(PORT,()=>console.log(`Backend running on http://localhost:${PORT}`));
  }catch(e){
    console.error("MySQL startup failed:", e.message);
    console.error("Check XAMPP MySQL, DB_HOST, DB_USER, DB_PASSWORD and DB_PORT in backend/.env");
    process.exit(1);
  }
})();
