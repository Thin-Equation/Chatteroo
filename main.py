#main.py

import json
import os
from dotenv import load_dotenv

from langchain_core.messages import HumanMessage, AIMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

load_dotenv()

app = Flask(__name__)

secret_key = os.urandom(24).hex()

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///chat_history.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = secret_key
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

db = SQLAlchemy(app)

# Database Model
class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    session_id = db.Column(db.String(50), nullable=False)
    role = db.Column(db.String(10), nullable=False)  # 'human' or 'ai'
    content = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'role': self.role,
            'content': self.content,
            'timestamp': self.timestamp.isoformat()
        }

class User(UserMixin, db.Model):
    chat_messages = db.relationship('ChatMessage', backref='user', lazy=True)
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(100), unique=True)
    password = db.Column(db.String(255))
    name = db.Column(db.String(100))
    
    def set_password(self, password):
        self.password = generate_password_hash(password, method='pbkdf2:sha256')
        
    def check_password(self, password):
        return check_password_hash(self.password, password)

# Create database tables
with app.app_context():
    db.create_all()

@app.route("/")
def index():
    return send_file('web/index.html')

@app.route("/api/generate", methods=["POST"])
@login_required
def generate_api():
    if request.method == "POST":
        try:
            req_body = request.get_json()
            content = req_body.get("contents")
            session_id = req_body.get("session_id")
            
            # Store human message in database
            human_message = ChatMessage(
                user_id=current_user.id,
                session_id=session_id,
                role='human',
                content=content[0]['text']  # Assuming first content is text
            )
            db.session.add(human_message)
            db.session.commit()

            # Get chat history for context
            history = ChatMessage.query.filter_by(
                user_id=current_user.id,
                session_id=session_id
            ).order_by(ChatMessage.timestamp).all()

            # Convert history to LangChain message format
            messages = []
            for msg in history[:-1]:  # Exclude the last message as we'll add it separately
                if msg.role == 'human':
                    messages.append(HumanMessage(content=msg.content))
                elif msg.role == 'ai':
                    messages.append(AIMessage(content=msg.content))
                else:
                    messages.append(AIMessage(content=msg.content))
            
            # Add the current message
            messages.append(HumanMessage(content=content[0]['text']))

            # Generate response using the model
            model = ChatGoogleGenerativeAI(model=req_body.get("model"))
            response = model.stream(messages)

            def generate_response(messages, session_id):
                complete_response = []
                for chunk in model.stream(messages):
                    complete_response.append(chunk.content)
                return ''.join(complete_response)

            def stream_response(content):
                for chunk in content:
                    yield 'data: %s\n\n' % json.dumps({"text": chunk})

            generated_content = generate_response(messages, session_id)
            ai_message = ChatMessage(
                user_id=current_user.id,
                session_id=session_id,
                role='ai',
                content=generated_content
            )
            db.session.add(ai_message)
            db.session.commit()
            return stream_response(generated_content), {'Content-Type': 'text/event-stream'}
        except Exception as e:    
            return jsonify({"error": str(e)})

@app.route('/api/history/<session_id>', methods=['GET'])
@login_required
def get_chat_history(session_id):
    history = ChatMessage.query.filter_by(
        user_id=current_user.id,
        session_id=session_id
    ).order_by(ChatMessage.timestamp).all()
    return jsonify([message.to_dict() for message in history])

@app.route('/api/history/', methods=['GET'])
@login_required
def get_all_chat_history():
    history = ChatMessage.query.filter_by(user_id=current_user.id).order_by(ChatMessage.timestamp).all()
    return jsonify([message.to_dict() for message in history])


@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('web', path)

@app.route('/api/history/<session_id>', methods=['DELETE'])
@login_required
def delete_chat_history(session_id):
    try:
        # Delete all messages for the session
        ChatMessage.query.filter_by(session_id=session_id).delete()
        db.session.commit()
        return jsonify({"message": "Chat history deleted successfully"})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/api/auth/status')
def auth_status():
    if current_user.is_authenticated:
        return jsonify({
            'authenticated': True,
            'user': {
                'email': current_user.email,
                'name': current_user.name
            }
        })
    return jsonify({'authenticated': False})

@app.route('/api/auth/login', methods=['POST'])
def login_api():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email')).first()
    
    if user and user.check_password(data.get('password')):
        login_user(user)
        return jsonify({
            'authenticated': True,
            'user': {
                'email': user.email,
                'name': user.name
            }
        })
    return jsonify({'error': 'Invalid credentials'}), 401


@app.route('/api/auth/signup', methods=['POST'])
def signup_api():
    if request.method == 'POST':  
        try:
            data = request.get_json()
            
            if not data.get('email') or not data.get('password'):
                return jsonify({'error': 'Email and password are required'}), 400
                
            if User.query.filter_by(email=data.get('email')).first():
                return jsonify({'error': 'Email already exists'}), 409
                
            user = User(
                email=data.get('email'),
                name=data.get('name')
            )
            user.set_password(data.get('password'))
            
            try:
                db.session.add(user)
                db.session.commit()
            except SQLAlchemyError as db_error:
                db.session.rollback()
                return jsonify({'error': 'Database error occurred'}), 500
                
            login_user(user)
            
            return jsonify({
                'authenticated': True,
                'user': {
                    'email': user.email,
                    'name': user.name
                }
            })
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/auth/logout', methods=['POST'])
@login_required
def logout_api():
    data = request.get_json()
    current_session = data.get('currentSessionId')
    
    if current_session:
        messages = ChatMessage.query.filter_by(
            session_id=current_session,
            user_id=current_user.id
        ).all()
        
        for message in messages:
            message.user_id = current_user.id
        db.session.commit()
    
    logout_user()
    return jsonify({'authenticated': False})

if __name__ == "__main__":
    app.run(port=int(os.environ.get('PORT', 80)))
