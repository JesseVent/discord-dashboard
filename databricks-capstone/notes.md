Video 1: Intro to Databricks: DataExpert.io AI Boot Camp Day 1
URL: https://www.youtube.com/watch?v=d-uOkAOrwJo
Summary
⚬	Platform Setup: Sign up for Databricks Free Edition for personal workspace access.
⚬	Catalog Management: Unity Catalog manages metadata for Delta tables stored on AWS S3.
⚬	SQL Execution: Create schemas and managed Delta tables in the SQL Editor.
⚬	Git & PySpark Integration: Connect GitHub repositories to workspace Git folders to build Spark data pipelines.
⚬	AI Agents: Query Delta tables using natural language queries via Databricks Genie.
⚬	Database Provisioning: Stand up Lakebase Postgres instances and enable Lakebase Search for vector workloads.
Homework Instructions
	1.	Sign up for a free Databricks account.
	2.	Fork the data-engineer-handbook repository on GitHub.
	3.	Create a custom schema and student table using the SQL Editor.
	4.	Build a PySpark pipeline in a workspace notebook to aggregate data into Delta tables.
	5.	Provision a Lakebase Postgres instance and enable Lakebase Search in project settings.
Video 2: Databricks AI Boot Camp Day 1: Setting Up your Lakebase and App
URL: https://www.youtube.com/watch?v=ZmaucG5JWig
Summary
⚬	OLTP vs. OLAP: Contrast low-latency transactional databases with analytical lakehouse storage.
⚬	Change Data Feed (CDF): Stream live database mutations directly to Delta tables without daily snapshots.
⚬	Role Permissions: Configure native password roles (student) on Lakebase Postgres.
⚬	App & Secrets Management: Bind Databricks custom apps to secret scopes containing Massive API keys and database URLs.
⚬	AI Refactoring: Use Databricks Genie to update front-end CSS styles and add UI buttons.
Homework Instructions
	1.	Fork the databicks-lakebase-app-day1 repository.
	2.	Create a Lakebase Postgres database and grant permissions to a student password role.
	3.	Generate an API key on Massive.com.
	4.	Run setup_secrets.py to store your Massive key and Lakebase URL in Databricks secret scopes.
	5.	Deploy a custom Databricks application connected to your repository and secrets.
	6.	Use Databricks Genie to update CSS styling and add a watchlist deletion feature.
Video 3: Databricks AI Boot camp Day 2: Context Engineering
URL: https://www.youtube.com/watch?v=paKE4mAKP5k
Summary
⚬	Agent Reliability: Prevent false positives and hallucinations using guardrails, context engineering, and multi-agent designs.
⚬	System Prompting: Optimize prompts systematically using evaluation frameworks like DSPy and AdalFlow.
⚬	Vector Mechanics: Process unstructured data using document chunking, overlap ratios, PGvector cosine similarity, and HNSW indexing.
⚬	Agent Architectures: Compare single-step tools, react loops, and multi-agent systems.
⚬	Pipeline Implementation: Ingest stock news, generate 1024-dimension embeddings via ai_query, and sync Delta tables to Lakebase.
Homework Instructions
	1.	Fork the databicks-lakebase-app-day2 repository.
	2.	Enable PGvector support on your Lakebase Postgres database.
	3.	Execute SQL DDL scripts to create document, embedding, and chunking tables with 1024 vector dimensions and HNSW indexes.
	4.	Run the ingest_ticker_news_embeddings PySpark notebook using ai_query for vector embeddings.
	5.	Sync embedded Delta tables back to Lakebase Postgres via the Databricks Catalog UI.
	6.	Submit Day 1 and Day 2 homework assignments on the platform.
Video 4: Databricks AI Boot Camp Day 0: Capstone Project Brainstorming
URL: https://www.youtube.com/watch?v=1AN_57ztfDc
Summary
⚬	Bootcamp Logistics: Assign study groups by time zone and review AI automated platform grading.
⚬	Submission Mechanics: Submit all assignments and capstone projects as compressed ZIP archives.
⚬	Capstone Options: Provide project templates including Movie Planner, Outdoor Planner, Research Copilot, Stock Research, and Job Search.
Homework & Capstone Instructions
	1.	Join your assigned time zone study group at learn.dataexpert.io/group.
	2.	Complete 3 weekly homework assignments by uploading ZIP archives for automated AI grading.
	3.	Build 1 Capstone Project meeting all 6 technical requirements:
⚬	Spark data pipeline.
⚬	Third-party API integration.
⚬	Unstructured data processing.
⚬	Databricks custom app front-end.
⚬	AI Agent with at least 2 functional tools.
⚬	Change Data Capture (CDF/CDC) streaming production database changes to Delta tables.
	4.	Zip all DDL scripts, Python files, and application code into a single archive.
	5.	Submit the final Capstone project ZIP file before August 9 at 10:00 PM.