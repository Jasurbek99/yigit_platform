"""Shared rules of the two login serializers (agent logins and seller logins)."""
from rest_framework import serializers

from apps.core.models import User
from apps.market.passwords import check_login_password

REQUIRED = 'Обязательное поле.'


class LoginSerializerMixin:
    """Username fixed after create, checked password, hashed password on save.

    Mix into a `ModelSerializer` over `User` that declares a write-only `password`
    field; set `login_role` to the role a created login gets.
    """

    login_role = ''

    def get_fields(self) -> dict:
        """Make `username` read-only on update: a login is never renamed."""
        fields = super().get_fields()
        if self.instance is not None:
            fields['username'].read_only = True
        return fields

    def check_login(self, attrs: dict, required_on_create: tuple[str, ...]) -> None:
        """Require `required_on_create` on create; run the password rules on any new password."""
        if self.instance is None:
            for key in required_on_create:
                if not attrs.get(key):
                    raise serializers.ValidationError({key: REQUIRED})
        password = attrs.get('password')
        if password:
            check_login_password(password, self.instance or User(
                username=attrs.get('username', ''), first_name=attrs.get('first_name', '')))

    def create_login(self, validated: dict) -> User:
        """Create a `login_role` user from `validated` (which must carry `password`)."""
        password = validated.pop('password')
        user = User(role=self.login_role, **validated)
        user.set_password(password)
        user.save()
        return user

    def update_login(self, user: User, validated: dict) -> User:
        """Apply `validated` to `user`; a `password` in it resets the password."""
        password = validated.pop('password', None)
        for key, value in validated.items():
            setattr(user, key, value)
        if password:
            user.set_password(password)
        user.save()
        return user
