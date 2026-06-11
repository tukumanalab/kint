module.exports = {
  apps: [
    {
      name: 'kint-backend',
      // uvコマンドを使用してFastAPIサーバーを起動します。
      // グローバルに uv がインストールされていない場合は、script に './.venv/bin/uvicorn'
      // を指定し、args に 'src.kint.main:app --host 127.0.0.1 --port 8000' を指定してください。
      script: 'uv',
      args: 'run uvicorn src.kint.main:app --host 127.0.0.1 --port 8000',
      interpreter: 'none',
      cwd: './',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
