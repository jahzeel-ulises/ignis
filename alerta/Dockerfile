# IGNIS Alerta: servidor de la simulación en vivo, explorador y vistas 3D/eventos.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py plan_control.py ./
COPY static ./static
RUN useradd --system --no-create-home ignis && mkdir -p /app/data && chown -R ignis /app
USER ignis
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=4s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/salud', timeout=3)"
CMD ["python", "server.py"]
