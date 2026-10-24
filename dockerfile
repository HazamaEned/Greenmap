FROM php:8.2-apache
RUN docker-php-ext-install mysqli
COPY . /var/www/html/
RUN mkdir -p /var/www/html/uploads/trees && chown -R www-data:www-data /var/www/html/uploads && chmod -R 775 /var/www/html/uploads
EXPOSE 80

EXPOSE 80